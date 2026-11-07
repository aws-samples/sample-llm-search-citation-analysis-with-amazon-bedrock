import * as cdk from 'aws-cdk-lib';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { SeoFeatureConstruct } from './seo-feature';

export const SEO_LIGHTHOUSE_STATE_MACHINE_NAME = 'CitationAnalysis-SeoLighthouse';

/**
 * One measure step: one DataForSEO Lighthouse call (up to 90 s) plus
 * parsing and storing a report of up to 10 MB.
 */
const MEASURE_TIMEOUT_SECONDS = 300;
const FAIL_TIMEOUT_SECONDS = 60;
/** A batch is at most 20 runs (10 pages on two devices), each a few minutes in the worst case. */
const STATE_MACHINE_TIMEOUT = cdk.Duration.hours(2);

/**
 * Page performance: Lighthouse runs (one page, or an audit's sample of pages)
 * and IndexNow (keys, key-file checks, submissions).
 *
 *   Measure -> Done? -yes-> Succeeded
 *      ^         | no
 *      +---------+
 *
 * Measure buys one Lighthouse report per invocation, so it is never retried:
 * DataForSEO bills a run when it executes it and a retry could buy it twice.
 * Fail is free and retried on Lambda service errors; anything that escapes
 * Measure runs Fail, which marks the run failed so the dashboard stops
 * polling. Runs, summaries, IndexNow keys and submission history live in
 * `CitationAnalysis-SeoCache` and the full reports under the stack's `seo/`
 * prefix of the raw-responses bucket, both already granted to the shared
 * functions; the feature adds no table. The jobs function's 1 GB holds one
 * parsed report comfortably, and the step parses one at a time, so no
 * separate high-memory function is needed. IndexNow requests are sent by the
 * router itself (free, at most three engines per host, each bounded by the
 * API's deadline).
 */
export class SeoPerformance extends SeoFeatureConstruct {
  protected build(): void {
    const measure = this.jobsTask('Measure', { step: 'lighthouse.measure', 'run_id.$': '$.run_id' }, {
      outputPath: '$.Payload',
      retryOnServiceExceptions: false,
      timeout: cdk.Duration.seconds(MEASURE_TIMEOUT_SECONDS),
    });
    const fail = this.jobsTask('Fail', {
      step: 'lighthouse.fail', 'run_id.$': '$.run_id', 'error.$': '$.error',
    }, {
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
      timeout: cdk.Duration.seconds(FAIL_TIMEOUT_SECONDS),
    });
    fail.next(new stepfunctions.Fail(this, 'RunFailed', {
      error: 'LighthouseRunFailed',
      cause: 'The Lighthouse run stopped; the run item records it as failed.',
    }));
    measure.addCatch(fail, { errors: ['States.ALL'], resultPath: '$.error' });
    measure.next(new stepfunctions.Choice(this, 'AllMeasured')
      .when(stepfunctions.Condition.booleanEquals('$.done', true), new stepfunctions.Succeed(this, 'Done'))
      .otherwise(measure));

    const stateMachine = this.stateMachine({
      logGroupId: 'LogGroup',
      stateMachineName: SEO_LIGHTHOUSE_STATE_MACHINE_NAME,
      definition: measure,
      timeout: STATE_MACHINE_TIMEOUT,
    });
    stateMachine.grantStartExecution(this.props.router);
    this.props.router.addEnvironment('SEO_LIGHTHOUSE_STATE_MACHINE_ARN', stateMachine.stateMachineArn);

    this.serve(
      ['lighthouse', ['GET', 'POST']],
      ['lighthouse/sample', ['GET']],
      ['lighthouse/batch', ['POST']],
      ['lighthouse/{run_id}', ['GET']],
      ['indexnow', ['GET']],
      ['indexnow/key', ['POST']],
      ['indexnow/check', ['POST']],
      ['indexnow/submit', ['POST']],
    );
  }
}
