import {
  describe, expect, it
} from 'vitest';
import { LAMBDA_SERVICE_ERRORS, resolvePath } from './citation-analysis-stack-fixtures';
import {
  TTL_ON_TTL_ATTRIBUTE, WAITS_ON_CALLBACKS, callbackWait, catchTargets, taskRetriers
} from './seo-feature-fixtures';
import { sharedTableActions } from './constructs/seo-feature';
import { PAID_STATES, synthesizeRankTrackingSnapshot } from './seo-rank-tracking-fixtures';

const snapshot = synthesizeRankTrackingSnapshot();

describe('rank tracking API routes', () => {
  it('serves the tracker, keyword, run and read routes', () => {
    expect(snapshot.routes).toStrictEqual([
      'DELETE /api/seo/rank-trackers/{trackerId}',
      'DELETE /api/seo/rank-trackers/{trackerId}/keywords',
      'GET /api/seo/rank-trackers',
      'GET /api/seo/rank-trackers/{trackerId}',
      'GET /api/seo/rank-trackers/{trackerId}/history',
      'GET /api/seo/rank-trackers/{trackerId}/results',
      'GET /api/seo/rank-trackers/{trackerId}/runs',
      'GET /api/seo/rank-trackers/{trackerId}/trend',
      'POST /api/seo/rank-trackers',
      'POST /api/seo/rank-trackers/{trackerId}/keywords',
      'POST /api/seo/rank-trackers/{trackerId}/runs',
      'POST /api/seo/rank-trackers/estimate',
      'PUT /api/seo/rank-trackers/{trackerId}',
    ]);
  });
});

describe('CitationAnalysis-SeoRankTracking table', () => {
  it('keys items on pk and sk with one secondary index (the tracker list; no index of due trackers)', () => {
    expect(snapshot.keys).toStrictEqual(['pk HASH', 'sk RANGE']);
    expect(snapshot.indexNames).toStrictEqual(['GSI1']);
  });

  it('expires lock items on the ttl attribute', () => {
    expect(snapshot.timeToLive).toStrictEqual(TTL_ON_TTL_ATTRIBUTE);
  });

  it('lets the router and the jobs function read, write, batch and delete items (locks, removed keywords), and nothing more', () => {
    const actions = sharedTableActions({ batchWrites: true, deletes: true });
    expect(snapshot.routerTableActions).toStrictEqual(actions);
    expect(snapshot.jobsTableActions).toStrictEqual(actions);
  });

  it('names the table and state machine in both functions environments', () => {
    const keys = ['DYNAMODB_TABLE_SEO_RANK_TRACKING', 'RANK_TRACKING_STATE_MACHINE_ARN'];

    expect(keys.filter((key) => !(key in snapshot.routerEnv))).toStrictEqual([]);
    expect(keys.filter((key) => !(key in snapshot.jobsEnv))).toStrictEqual([]);
  });
});

describe('CitationAnalysis-SeoRankCheck state machine', () => {
  it('lets the router only start the rank check state machine, and the jobs function also resume its post step', () => {
    const start = { actions: ['states:StartExecution'], onStateMachine: true };

    expect(snapshot.routerRankCheckGrants).toStrictEqual([start]);
    // SendTaskSuccess names the rank and the local SEO state machines (`SeoCallbacks`).
    expect(snapshot.jobsRankCheckGrants).toStrictEqual([{ actions: ['states:SendTaskSuccess'], onStateMachine: false }, start]);
  });

  it('never retries the paid live check or task post steps', () => {
    const retriers = taskRetriers(snapshot.states);

    expect(PAID_STATES.map((name) => retriers[name])).toStrictEqual([[], []]);
  });

  it('retries the free steps on Lambda service errors', () => {
    const retriers = taskRetriers(snapshot.states);
    const free = ['Prepare', 'PlanRetry', 'Finalize', 'FailRun'].map((name) => retriers[name]);

    expect(free).toStrictEqual([[LAMBDA_SERVICE_ERRORS], [LAMBDA_SERVICE_ERRORS], [LAMBDA_SERVICE_ERRORS],
      [LAMBDA_SERVICE_ERRORS]]);
  });

  it('retries a failed collect step twice since polling is free', () => {
    expect(taskRetriers(snapshot.states).CollectTasks).toStrictEqual([LAMBDA_SERVICE_ERRORS, ['States.TaskFailed']]);
  });

  it('bounds every task by the jobs function timeout, and the post by 35 minutes for DataForSEO\'s callbacks', () => {
    const timeouts = Object.fromEntries(Object.entries(snapshot.states)
      .filter(([, state]) => resolvePath(state, ['Type']) === 'Task')
      .map(([name, state]) => [name, resolvePath(state, ['TimeoutSeconds'])]));

    expect(timeouts).toStrictEqual({
      Prepare: 900, LiveChecks: 900, PostTasks: 2100, CollectTasks: 900, PlanRetry: 900, Finalize: 900, FailRun: 900,
    });
  });

  it('fails the run through the fail step when any task throws; a post whose callbacks never came collects once', () => {
    expect(PAID_STATES.map((name) => catchTargets(snapshot.states[name]))).toStrictEqual([
      ['FailRun'], ['States.Timeout -> CollectTasks', 'FailRun'],
    ]);
  });

  it('waits for DataForSEO\'s callbacks on a task token instead of polling', () => {
    expect(callbackWait(snapshot.states, 'PostTasks')).toStrictEqual(WAITS_ON_CALLBACKS);
  });

  it('stops a run after three hours at most', () => {
    expect(snapshot.definitionTimeoutSeconds).toBe(10_800);
  });
});

describe('rank tracker schedules', () => {
  it('holds each tracker\'s own schedule in one group and runs no polling rule', () => {
    expect(snapshot.scheduleGroups).toStrictEqual(['citation-analysis-seo-rank']);
    expect(snapshot.ruleNames).toStrictEqual([]);
  });

  it('lets the router and the jobs function create, move and delete the trackers\' schedules only', () => {
    const actions = ['scheduler:CreateSchedule', 'scheduler:DeleteSchedule', 'scheduler:UpdateSchedule'];

    expect(snapshot.routerScheduleActions).toStrictEqual(actions);
    expect(snapshot.jobsScheduleActions).toStrictEqual(actions);
  });

  it('lets EventBridge Scheduler only invoke the jobs function', () => {
    expect(snapshot.schedulerRoleJobsActions).toStrictEqual(['lambda:InvokeFunction']);
  });

  it('names the schedules\' target and role in both functions\' environments', () => {
    const named = [snapshot.routerEnv, snapshot.jobsEnv].map((env) => ['RANK_TRACKER_TARGET_ARN', 'RANK_TRACKER_SCHEDULER_ROLE_ARN']
      .every((key) => key in env));

    expect(named).toStrictEqual([true, true]);
  });
});
