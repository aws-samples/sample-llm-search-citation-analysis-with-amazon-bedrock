import * as cdk from 'aws-cdk-lib';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import type * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { SeoFeatureConstruct } from './seo-feature';

export const SEO_LOCAL_JOB_STATE_MACHINE_NAME = 'CitationAnalysis-SeoLocalJob';

/** The jobs function's own limit: a task never outlives the invocation it waits for. */
const STEP_TIMEOUT_SECONDS = 900;
/**
 * Posting, then waiting for DataForSEO's callbacks (priority-2 tasks usually
 * settle within 10-40 s); past it the job collects once anyway.
 */
const POST_AND_CALLBACKS_TIMEOUT_MINUTES = 25;
/** Post and callbacks, then one collect. */
const STATE_MACHINE_TIMEOUT_MINUTES = 60;

/**
 * Local SEO (business listings, Google Business Profile, Maps results, local
 * rank grid): the `/api/seo/local/...` routes and the job state machine for
 * the queued DataForSEO work (reviews, profile updates, rank grids).
 *
 *   Post (waits for DataForSEO's callbacks) -> Finished? -yes-> Done
 *                                               | no
 *                                               Collect -> Done
 *
 * Post is a `waitForTaskToken` task: it opens a callback gate, buys the tasks
 * with the gate's `pingback_url`, and the job resumes when DataForSEO has
 * called back for every task (`SeoCallbacks`); when the wait times out it
 * collects once anyway. Nothing polls the queue. Post is never retried:
 * DataForSEO bills a task when it is posted and a retry could buy it twice.
 * Collect and Fail are free and retried on Lambda service errors. Anything
 * else that escapes Post or Collect runs Fail, which marks the job failed so
 * the dashboard stops polling. Jobs and
 * results live in `CitationAnalysis-SeoCache`, which both shared functions can
 * already read and write; the feature adds no table.
 */
export class SeoLocal extends SeoFeatureConstruct {
  protected build(): void {
    const post = this.jobsTask('Post', {
      step: 'local.post', 'job_id.$': '$.job_id', task_token: stepfunctions.JsonPath.taskToken,
    }, {
      integrationPattern: stepfunctions.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      retryOnServiceExceptions: false,
      timeout: cdk.Duration.minutes(POST_AND_CALLBACKS_TIMEOUT_MINUTES),
    });
    const collect = this.jobStep('Collect', {
      step: 'local.collect', 'job_id.$': '$.job_id',
    }, true);
    const fail = this.jobStep('Fail', { step: 'local.fail', 'job_id.$': '$.job_id', 'error.$': '$.error' }, true);
    fail.next(new stepfunctions.Fail(this, 'JobFailed', {
      error: 'LocalSeoJobFailed',
      cause: 'The local SEO job stopped; the job item records it as failed.',
    }));
    // A callback that never came: collect once anyway (the input `{job_id}` is kept).
    post.addCatch(collect, { errors: ['States.Timeout'], resultPath: stepfunctions.JsonPath.DISCARD });
    for (const state of [post, collect]) {
      state.addCatch(fail, { errors: ['States.ALL'], resultPath: '$.error' });
    }

    const done = new stepfunctions.Succeed(this, 'Done');
    const finished = new stepfunctions.Choice(this, 'Finished')
      .when(stepfunctions.Condition.booleanEquals('$.done', true), done)
      .otherwise(collect);
    collect.next(done);

    const stateMachine = this.stateMachine({
      logGroupId: 'LogGroup',
      stateMachineName: SEO_LOCAL_JOB_STATE_MACHINE_NAME,
      definition: post.next(finished),
      timeout: cdk.Duration.minutes(STATE_MACHINE_TIMEOUT_MINUTES),
    });
    stateMachine.grantStartExecution(this.props.router);
    this.props.router.addEnvironment('SEO_LOCAL_JOB_STATE_MACHINE_ARN', stateMachine.stateMachineArn);

    this.serve(
      ['local/categories', ['GET']],
      ['local/businesses', ['POST']],
      ['local/profile', ['POST']],
      ['local/questions', ['POST']],
      ['local/serp', ['POST']],
      ['local/jobs', ['POST']],
      ['local/jobs/{job_id}', ['GET']],
    );
  }

  /** One jobs-function step; its output is the step's small JSON answer (`{job_id, done, attempt}`). */
  private jobStep(id: string, payload: Record<string, unknown>, retryOnServiceExceptions: boolean): tasks.LambdaInvoke {
    return this.jobsTask(id, payload, {
      outputPath: '$.Payload',
      retryOnServiceExceptions,
      timeout: cdk.Duration.seconds(STEP_TIMEOUT_SECONDS),
    });
  }
}
