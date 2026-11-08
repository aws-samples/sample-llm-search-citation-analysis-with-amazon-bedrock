import * as cdk from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import type * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { SEO_JOBS_FUNCTION_NAME, SeoFeatureConstruct, stringKey } from './seo-feature';

/** The rank check state machine's name; its ARN is built from it so the functions can start it without a cycle. */
export const RANK_CHECK_STATE_MACHINE_NAME = 'CitationAnalysis-SeoRankCheck';
/** One EventBridge Scheduler schedule per scheduled tracker lives in this group (`rank-<tracker id>`). */
export const RANK_TRACKER_SCHEDULE_GROUP = 'citation-analysis-seo-rank';
const TABLE_NAME = 'CitationAnalysis-SeoRankTracking';
/** Longer than the longest run (1000 keywords x 2 devices live, then two queued rounds of 15-minute polling). */
const STATE_MACHINE_TIMEOUT = cdk.Duration.hours(3);
/** The jobs function's own limit: a step never outlives it. */
const STEP_TIMEOUT = cdk.Duration.minutes(15);

/** A string partition key and sort key. */
function stringKeys(partition: string, sort: string): { partitionKey: dynamodb.Attribute; sortKey: dynamodb.Attribute } {
  return { partitionKey: stringKey(partition), sortKey: stringKey(sort) };
}

/** Which step of a choice's `$.next` leads where. */
type Routes = Record<string, stepfunctions.IChainable>;

/**
 * Rank tracking: the `CitationAnalysis-SeoRankTracking` table, the
 * `CitationAnalysis-SeoRankCheck` state machine that runs one check of a
 * tracker, and the `citation-analysis-seo-rank` schedule group. Each
 * scheduled tracker has its own one-time EventBridge Scheduler schedule at its
 * next slot (`rank-<tracker id>`), which invokes the jobs function with
 * `{"step": "rank.due"}`; the router writes it when a tracker is saved, and
 * `rank.due` moves it after each run. Nothing runs between checks.
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
      globalSecondaryIndexes: [{ indexName: 'GSI1', ...stringKeys('gsi1pk', 'gsi1sk') }],
    }, { batchWrites: true, deletes: true }); // deletes: the run lock on release, a keyword an Admin removes from a tracker

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
    this.trackerSchedules();

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

  /**
   * The group of the trackers' own schedules, the role EventBridge Scheduler
   * invokes the jobs function with, and the router's and the jobs function's
   * rights to write those schedules (and only those).
   */
  private trackerSchedules(): void {
    const { router, jobs } = this.props;
    const stack = cdk.Stack.of(this);
    new scheduler.CfnScheduleGroup(this, 'TrackerScheduleGroup', { name: RANK_TRACKER_SCHEDULE_GROUP });
    const role = new iam.Role(this, 'TrackerSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': stack.account } },
      }),
      description: 'Rank tracker schedules: invoke the SEO jobs function with rank.due',
    });
    // Built from the name: the jobs function cannot carry its own ARN (a template cycle).
    const jobsArn = stack.formatArn({
      service: 'lambda',
      resource: 'function',
      resourceName: SEO_JOBS_FUNCTION_NAME,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    role.addToPolicy(new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [jobsArn] }));
    const schedules = stack.formatArn({
      service: 'scheduler',
      resource: 'schedule',
      resourceName: `${RANK_TRACKER_SCHEDULE_GROUP}/rank-*`,
    });
    for (const fn of [router, jobs]) {
      fn.addEnvironment('RANK_TRACKER_TARGET_ARN', jobsArn);
      fn.addEnvironment('RANK_TRACKER_SCHEDULER_ROLE_ARN', role.roleArn);
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['scheduler:CreateSchedule', 'scheduler:UpdateSchedule', 'scheduler:DeleteSchedule'],
        resources: [schedules],
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [role.roleArn] }));
    }
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
