import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { allow } from './permissions';
import { SeoFeatureConstruct, stringKey } from './seo-feature';
import { citationAnalysisTable } from './tables';

export const SEO_DOMAIN_SNAPSHOTS_TABLE = 'CitationAnalysis-SeoDomainSnapshots';
export const SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE = 'CitationAnalysis-SeoDomainSnapshots';
/** The Action Center's status table (main stack, by name): SEO recommendations join their status from it. */
const RECOMMENDATION_STATUS_TABLE = 'CitationAnalysis-RecommendationStatus';

/** Snapshots at most two domain x market pairs at a time, below Labs' concurrency and the jobs function's. */
const SNAPSHOT_CONCURRENCY = 2;
/** One snapshot is two Labs calls of up to two minutes each. */
const SNAPSHOT_TASK_TIMEOUT = cdk.Duration.minutes(5);
const LIST_TASK_TIMEOUT = cdk.Duration.minutes(1);
const EXECUTION_TIMEOUT = cdk.Duration.hours(3);

/** The router reads snapshots; the jobs function also puts them. No update, batch or delete (TENETS.md, D1 and D5). */
const SNAPSHOT_READ_ACTIONS = ['dynamodb:GetItem', 'dynamodb:Query'];
const SNAPSHOT_WRITE_ACTIONS = [...SNAPSHOT_READ_ACTIONS, 'dynamodb:PutItem'];

/** Errors of an invocation Lambda refused before running the function: safe to retry, nothing was billed. */
const LAMBDA_THROTTLE_ERRORS = ['Lambda.TooManyRequestsException', 'Lambda.ServiceException'];

/**
 * Domain Overview, estimated-traffic snapshots and the SEO recommendations.
 *
 * - `CitationAnalysis-SeoDomainSnapshots` (pk `domain#market_id`, sk
 *   `snapshot_at`, kept, never expired): the summary of each snapshot; its
 *   ranked keywords live under `seo/domain-snapshots/` in the raw-responses
 *   bucket (already granted to both functions under `seo/*`).
 * - The `CitationAnalysis-SeoDomainSnapshots` state machine: list the targets
 *   (free) and snapshot each, two at a time. A snapshot task is billed
 *   DataForSEO work, so it is never retried, not even on a Lambda service
 *   error (the call may already have been sent); a failed snapshot is caught
 *   so the others still run. Only the free listing retries throttles.
 * - A Schedule (Operations > Schedule, kind "Domain traffic snapshots": an
 *   EventBridge Scheduler schedule an Admin creates in the main stack) starts
 *   it over every owned and competitor domain; nothing runs while no schedule
 *   exists. The Admin route starts it for one target.
 * - The router reads snapshots, starts executions and reads the
 *   recommendation statuses; the jobs function writes snapshots.
 */
export class SeoDomain extends SeoFeatureConstruct {
  protected build(): void {
    const { router, jobs } = this.props;
    const snapshotsTable = citationAnalysisTable(this, 'SnapshotsTable', {
      tableName: SEO_DOMAIN_SNAPSHOTS_TABLE,
      partitionKey: stringKey('pk'),
      sortKey: stringKey('snapshot_at'),
    });
    snapshotsTable.grant(router, ...SNAPSHOT_READ_ACTIONS);
    snapshotsTable.grant(jobs, ...SNAPSHOT_WRITE_ACTIONS);

    const stateMachine = this.snapshotStateMachine();
    stateMachine.grantStartExecution(router);


    const statusTable = dynamodb.Table.fromTableName(this, 'RecommendationStatusTable', RECOMMENDATION_STATUS_TABLE);
    allow(router, ['dynamodb:BatchGetItem'], [statusTable.tableArn]);

    for (const fn of [router, jobs]) {
      fn.addEnvironment('DYNAMODB_TABLE_SEO_DOMAIN_SNAPSHOTS', snapshotsTable.tableName);
    }
    router.addEnvironment('SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE_ARN', stateMachine.stateMachineArn);
    router.addEnvironment('DYNAMODB_TABLE_RECOMMENDATION_STATUS', RECOMMENDATION_STATUS_TABLE);

    this.serve(
      ['domains/overview', ['POST']],
      ['domains/keywords', ['POST']],
      ['domains/pages', ['POST']],
      ['domains/competitors', ['POST']],
      ['domains/snapshots', ['GET', 'POST']],
      ['insights', ['GET']],
    );
  }

  private snapshotStateMachine(): stepfunctions.StateMachine {
    const listTargets = this.jobsTask('ListTargets', { step: 'domain.snapshot_all', 'input.$': '$' }, {
      payloadResponseOnly: true,
      retryOnServiceExceptions: false,
      timeout: LIST_TASK_TIMEOUT,
    });
    listTargets.addRetry({ errors: LAMBDA_THROTTLE_ERRORS, interval: cdk.Duration.seconds(5), maxAttempts: 3, backoffRate: 2 });

    const snapshotOne = this.jobsTask('SnapshotOne', {
      step: 'domain.snapshot_one',
      'domain.$': '$.domain',
      'market_id.$': '$.market_id',
    }, {
      payloadResponseOnly: true,
      // Billed DataForSEO work: never re-sent.
      retryOnServiceExceptions: false,
      timeout: SNAPSHOT_TASK_TIMEOUT,
    });
    snapshotOne.addCatch(new stepfunctions.Pass(this, 'SnapshotFailed', {
      parameters: { 'domain.$': '$.domain', 'market_id.$': '$.market_id', status: 'failed' },
    }), { resultPath: stepfunctions.JsonPath.DISCARD });

    const snapshotEach = new stepfunctions.Map(this, 'SnapshotEach', {
      itemsPath: '$.targets',
      maxConcurrency: SNAPSHOT_CONCURRENCY,
      resultSelector: { 'count.$': 'States.ArrayLength($)' },
    }).itemProcessor(snapshotOne);

    return this.stateMachine({
      stateMachineName: SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE,
      definition: listTargets.next(snapshotEach),
      timeout: EXECUTION_TIMEOUT,
    });
  }
}
