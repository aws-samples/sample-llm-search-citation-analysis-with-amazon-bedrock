import * as cdk from 'aws-cdk-lib';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import type * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { allow } from './permissions';
import { SeoFeatureConstruct } from './seo-feature';
import { stringKey } from './tables';

export const SITE_AUDIT_STATE_MACHINE_NAME = 'CitationAnalysis-SiteAudit';
export const SEO_AUDITS_TABLE_NAME = 'CitationAnalysis-SeoAudits';

/** 2,000 pages at one request a second plus up to 30 minutes of rate-limit pauses fits well inside this. */
const STATE_MACHINE_TIMEOUT = cdk.Duration.hours(4);

/**
 * Lambda service failures worth another attempt. No audit step calls a paid
 * API, so retrying one never bills twice; a crawl chunk is idempotent (it
 * re-crawls exactly the URLs it had leased).
 */
const LAMBDA_SERVICE_ERRORS = [
  'Lambda.ClientExecutionTimeoutException',
  'Lambda.ServiceException',
  'Lambda.AWSLambdaException',
  'Lambda.SdkClientException',
  'Lambda.TooManyRequestsException',
];

interface StepSpec {
  /** Seconds before Step Functions gives up on the step (below the jobs function's 15-minute timeout). */
  timeoutSeconds: number;
  maxAttempts: number;
  intervalSeconds: number;
  backoffRate: number;
}

/**
 * Explicit timeout and retry per step: a platform default (minutes of retries)
 * would replay a doomed step against a site for an hour. Discovery may read up
 * to 300 sitemaps at one request a second; a crawl chunk stops itself after 90 s.
 */
const STEPS: Record<'start' | 'crawl' | 'finalize' | 'fail', StepSpec> = {
  start: { timeoutSeconds: 840, maxAttempts: 2, intervalSeconds: 5, backoffRate: 2 },
  crawl: { timeoutSeconds: 300, maxAttempts: 1, intervalSeconds: 10, backoffRate: 1 },
  finalize: { timeoutSeconds: 600, maxAttempts: 2, intervalSeconds: 5, backoffRate: 2 },
  fail: { timeoutSeconds: 60, maxAttempts: 3, intervalSeconds: 5, backoffRate: 2 },
};

/**
 * Site audit: crawls the brand's own site with plain HTTP (no paid API, no
 * browser) and stores pages and SEO / AI-readiness issues.
 *
 * - Table `CitationAnalysis-SeoAudits`: audits, frontier URLs, pages, issues
 *   and the link-graph summary under `pk`/`sk`, the `GSI1` index for the audit
 *   list and frontier claims. Only frontier URLs (crawl bookkeeping) expire,
 *   90 days after they are queued; audits, pages, issues and link summaries
 *   are kept (TENETS.md, D2 and D5).
 * - State machine `CitationAnalysis-SiteAudit`: Start (discovery) -> Crawl
 *   chunk loop (a Wait state honours the site's rate-limit pauses) ->
 *   Finalize; any failure -> Fail (recorded on the audit). Its input is the
 *   audit id only, since execution input is kept in the history.
 * - The router may start and stop its executions and read/write the table;
 *   the jobs function runs the steps (robots.txt copies under
 *   `seo/site-audit/` in the SEO bucket, already granted).
 */
export class SeoSiteAudit extends SeoFeatureConstruct {
  protected build(): void {
    this.sharedTable('SeoAuditsTable', 'DYNAMODB_TABLE_SEO_AUDITS', {
      tableName: SEO_AUDITS_TABLE_NAME,
      partitionKey: stringKey('pk'),
      sortKey: stringKey('sk'),
      timeToLiveAttribute: 'ttl',
      globalSecondaryIndexes: [{ indexName: 'GSI1', partitionKey: stringKey('gsi1pk'), sortKey: stringKey('gsi1sk') }],
    }, { batchWrites: true });

    const { router } = this.props;
    const stateMachine = this.auditStateMachine();
    router.addEnvironment('SITE_AUDIT_STATE_MACHINE_ARN', stateMachine.stateMachineArn);
    allow(router, ['states:StartExecution'], [stateMachine.stateMachineArn]);
    allow(router, ['states:StopExecution'], [cdk.Stack.of(this).formatArn({
      service: 'states',
      resource: 'execution',
      resourceName: `${SITE_AUDIT_STATE_MACHINE_NAME}:*`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    })]);

    // Start and list, detail (polled), issues, pages, cancel.
    this.serve(
      ['audits', ['GET', 'POST']],
      ['audits/{auditId}', ['GET']],
      ['audits/{auditId}/issues', ['GET']],
      ['audits/{auditId}/pages', ['GET']],
      ['audits/{auditId}/cancel', ['POST']],
    );
  }

  private step(id: string, payload: Record<string, unknown>, spec: StepSpec): tasks.LambdaInvoke {
    const task = this.jobsTask(id, payload, {
      outputPath: '$.Payload',
      retryOnServiceExceptions: false,
      timeout: cdk.Duration.seconds(spec.timeoutSeconds),
    });
    task.addRetry({
      errors: LAMBDA_SERVICE_ERRORS,
      maxAttempts: spec.maxAttempts,
      interval: cdk.Duration.seconds(spec.intervalSeconds),
      backoffRate: spec.backoffRate,
    });
    return task;
  }

  private auditStateMachine(): stepfunctions.StateMachine {
    const auditId = { 'audit_id.$': '$.audit_id' };
    const start = this.step('StartAudit', { step: 'audit.start', ...auditId }, STEPS.start);
    const crawl = this.step('CrawlChunk', {
      step: 'audit.crawl', ...auditId, 'chunk_no.$': '$.chunk_no',
    }, STEPS.crawl);
    const finalize = this.step('FinalizeAudit', { step: 'audit.finalize', ...auditId }, STEPS.finalize);
    const fail = this.step('FailAudit', {
      step: 'audit.fail', ...auditId, 'error.$': '$.error',
    }, STEPS.fail);
    fail.next(new stepfunctions.Fail(this, 'AuditFailed', {
      error: 'SiteAuditFailed',
      cause: 'The audit could not be completed; see the audit record for details.',
    }));
    for (const state of [start, crawl, finalize]) {
      state.addCatch(fail, { errors: ['States.ALL'], resultPath: '$.error' });
    }

    // The site's rate-limit pause (0 s normally) is waited here, not inside a Lambda.
    const pause = new stepfunctions.Wait(this, 'CrawlPause', {
      time: stepfunctions.WaitTime.secondsPath('$.wait_seconds'),
    });
    const crawlDone = new stepfunctions.Choice(this, 'CrawlDone')
      .when(stepfunctions.Condition.booleanEquals('$.done', true), finalize)
      .otherwise(pause);
    pause.next(crawl);
    crawl.next(crawlDone);

    return this.stateMachine({
      stateMachineName: SITE_AUDIT_STATE_MACHINE_NAME,
      definition: start.next(crawlDone),
      timeout: STATE_MACHINE_TIMEOUT,
    });
  }
}
