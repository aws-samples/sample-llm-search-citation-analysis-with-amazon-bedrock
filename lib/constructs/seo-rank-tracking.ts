import * as cdk from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import type * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { SeoFeatureConstruct, stringKey } from './seo-feature';

/** The rank check state machine's name; its ARN is built from it so the functions can start it without a cycle. */
export const RANK_CHECK_STATE_MACHINE_NAME = 'CitationAnalysis-SeoRankCheck';
const TABLE_NAME = 'CitationAnalysis-SeoRankTracking';
/** Longer than the longest run (1000 keywords x 2 devices live, then two queued rounds of 15-minute polling). */
const STATE_MACHINE_TIMEOUT = cdk.Duration.hours(3);
/** The jobs function's own limit: a step never outlives it. */
const STEP_TIMEOUT = cdk.Duration.minutes(15);
const SCHEDULE_RATE = cdk.Duration.minutes(15);

/** A string partition key and sort key. */
function stringKeys(partition: string, sort: string): { partitionKey: dynamodb.Attribute; sortKey: dynamodb.Attribute } {
  return { partitionKey: stringKey(partition), sortKey: stringKey(sort) };
}

/** Which step of a choice's `$.next` leads where. */
type Routes = Record<string, stepfunctions.IChainable>;

/**
 * Rank tracking: the `CitationAnalysis-SeoRankTracking` table, the
 * `CitationAnalysis-SeoRankCheck` state machine that runs one check of a
 * tracker, and the 15-minute EventBridge rule that starts scheduled checks.
 *
 * Every task invokes the SEO jobs function with `{"step": "rank.<name>",
 * "state": <the small run state>}`; each step answers the state with `next`,
 * which a Choice follows. The paid steps (`rank.live`, `rank.post`) are never
 * retried: DataForSEO bills a call even when its answer is lost, so a retry
 * could pay twice. The free steps retry Lambda service errors, and `rank.collect`
 * (free polling) also retries its own errors. Any failure runs `rank.fail`,
 * which fails the run and frees the tracker.
 */
export class SeoRankTracking extends SeoFeatureConstruct {
  protected build(): void {
    const { router, jobs } = this.props;
    this.sharedTable('Table', 'DYNAMODB_TABLE_SEO_RANK_TRACKING', {
      tableName: TABLE_NAME,
      ...stringKeys('pk', 'sk'),
      timeToLiveAttribute: 'ttl',
      globalSecondaryIndexes: [
        { indexName: 'GSI1', ...stringKeys('gsi1pk', 'gsi1sk') },
        { indexName: 'GSI2', ...stringKeys('gsi2pk', 'gsi2sk') },
      ],
    });

    const stateMachineArn = cdk.Stack.of(this).formatArn({
      service: 'states',
      resource: 'stateMachine',
      resourceName: RANK_CHECK_STATE_MACHINE_NAME,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    for (const fn of [router, jobs]) {
      fn.addEnvironment('RANK_TRACKING_STATE_MACHINE_ARN', stateMachineArn);
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['states:StartExecution'], resources: [stateMachineArn] }));
    }

    this.rankCheckStateMachine();

    new events.Rule(this, 'ScheduleRule', {
      ruleName: 'CitationAnalysis-SeoRankTrackingTick',
      description: 'Starts the rank checks of due rank trackers',
      schedule: events.Schedule.rate(SCHEDULE_RATE),
      targets: [new targets.LambdaFunction(jobs, {
        event: events.RuleTargetInput.fromObject({ step: 'rank.tick' }),
        retryAttempts: 0,
      })],
    });

    this.serve(
      ['rank-trackers', ['GET', 'POST']],
      ['rank-trackers/estimate', ['POST']],
      ['rank-trackers/{trackerId}', ['GET', 'PUT', 'DELETE']],
      ['rank-trackers/{trackerId}/keywords', ['POST', 'DELETE']],
      ['rank-trackers/{trackerId}/runs', ['GET', 'POST']],
      ['rank-trackers/{trackerId}/results', ['GET']],
      ['rank-trackers/{trackerId}/history', ['GET']],
      ['rank-trackers/{trackerId}/trend', ['GET']],
    );
  }

  /** One jobs-function task; `retry` = free step, retried on Lambda service errors. */
  private step(id: string, step: string, retry: boolean): tasks.LambdaInvoke {
    return this.jobsTask(id, { step, 'state.$': '$' }, {
      payloadResponseOnly: true,
      retryOnServiceExceptions: retry,
      timeout: STEP_TIMEOUT,
    });
  }

  private choice(id: string, routes: Routes): stepfunctions.Choice {
    const choice = new stepfunctions.Choice(this, id);
    for (const [next, target] of Object.entries(routes)) {
      choice.when(stepfunctions.Condition.stringEquals('$.next', next), target);
    }
    return choice.otherwise(new stepfunctions.Fail(this, `${id}Unknown`, { error: 'UnknownNextStep' }));
  }

  private rankCheckStateMachine(): stepfunctions.StateMachine {
    const failRun = this.step('FailRun', 'rank.fail', true)
      .next(new stepfunctions.Fail(this, 'RunFailed', { error: 'RankCheckFailed' }));
    const done = new stepfunctions.Succeed(this, 'Done');
    const catching = <T extends tasks.LambdaInvoke>(task: T): T => {
      task.addCatch(failRun, { errors: ['States.ALL'], resultPath: '$.error' });
      return task;
    };

    const prepare = catching(this.step('Prepare', 'rank.prepare', true));
    const live = catching(this.step('LiveChecks', 'rank.live', false));
    const post = catching(this.step('PostTasks', 'rank.post', false));
    const collect = catching(this.step('CollectTasks', 'rank.collect', true));
    collect.addRetry({ errors: ['States.TaskFailed'], maxAttempts: 2, interval: cdk.Duration.seconds(10) });
    const planRetry = catching(this.step('PlanRetry', 'rank.plan_retry', true));
    const finalize = catching(this.step('Finalize', 'rank.finalize', true));
    const wait = new stepfunctions.Wait(this, 'WaitForTasks', {
      time: stepfunctions.WaitTime.secondsPath('$.wait_seconds'),
    });

    prepare.next(this.choice('AfterPrepare', { stop: done, live, queued: post }));
    live.next(this.choice('AfterLive', { live, retry: planRetry, finalize }));
    post.next(this.choice('AfterPost', { wait, retry: planRetry, finalize }));
    wait.next(collect);
    collect.next(this.choice('AfterCollect', { collect, wait, retry: planRetry }));
    planRetry.next(this.choice('AfterPlanRetry', { queued: post, finalize }));
    finalize.next(done);

    return this.stateMachine({
      logGroupId: 'LogGroup',
      stateMachineName: RANK_CHECK_STATE_MACHINE_NAME,
      definition: prepare,
      timeout: STATE_MACHINE_TIMEOUT,
    });
  }
}
