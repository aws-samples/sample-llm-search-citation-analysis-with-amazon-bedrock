import {
  describe, expect, it
} from 'vitest';
import { LAMBDA_SERVICE_ERRORS, resolvePath } from './citation-analysis-stack-fixtures';
import {
  TTL_ON_TTL_ATTRIBUTE, taskRetriers
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
  it('keys items on pk and sk with two secondary indexes', () => {
    expect(snapshot.keys).toStrictEqual(['pk HASH', 'sk RANGE']);
    expect(snapshot.indexNames).toStrictEqual(['GSI1', 'GSI2']);
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
  it('lets the router and the jobs function only start the rank check state machine, never touch its executions', () => {
    const startOnly = [{ actions: ['states:StartExecution'], onStateMachine: true }];

    expect(snapshot.routerRankCheckGrants).toStrictEqual(startOnly);
    expect(snapshot.jobsRankCheckGrants).toStrictEqual(startOnly);
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

  it('bounds every task by the jobs function timeout', () => {
    const timeouts = Object.values(snapshot.states)
      .filter((state) => resolvePath(state, ['Type']) === 'Task')
      .map((state) => resolvePath(state, ['TimeoutSeconds']));

    expect(new Set(timeouts)).toStrictEqual(new Set([900]));
  });

  it('fails the run through the fail step when any task throws', () => {
    const catchTargets = PAID_STATES.map((name) => resolvePath(snapshot.states[name], ['Catch', '0', 'Next']));

    expect(catchTargets).toStrictEqual(['FailRun', 'FailRun']);
  });

  it('waits for queued tasks for the seconds each step chooses', () => {
    expect(resolvePath(snapshot.states.WaitForTasks, ['SecondsPath'])).toBe('$.wait_seconds');
  });

  it('stops a run after three hours at most', () => {
    expect(snapshot.definitionTimeoutSeconds).toBe(10_800);
  });
});

describe('rank tracking schedule', () => {
  it('runs the scheduler tick every 15 minutes', () => {
    expect(snapshot.ruleSchedule).toBe('rate(15 minutes)');
    expect(snapshot.ruleInput).toBe('{"step":"rank.tick"}');
  });
});
