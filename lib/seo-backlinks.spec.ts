import {
  describe, expect, it
} from 'vitest';
import { resolvePath } from './citation-analysis-stack-fixtures';
import { synthesizeBacklinksSnapshot } from './seo-backlinks-fixtures';
import {
  JOBS_STATE_MACHINE_ROLE_ACTIONS
} from './seo-feature-fixtures';
import { sharedTableActions } from './constructs/seo-feature';

/** `SeoBacklinks`: the backlinks explorer routes and the weekly snapshots, inside the SEO stack. */
const snapshot = synthesizeBacklinksSnapshot();

describe('SeoBacklinks routes', () => {
  it('serves the explorer and snapshot routes', () => {
    expect(snapshot.routes).toStrictEqual([
      'GET /api/seo/backlinks/snapshots',
      'POST /api/seo/backlinks/overview',
      'POST /api/seo/backlinks/referring-domains',
      'POST /api/seo/backlinks/rows',
      'POST /api/seo/backlinks/snapshots',
      'POST /api/seo/backlinks/top-pages',
      'PUT /api/seo/backlinks/snapshots/schedule',
    ]);
  });
});

describe('CitationAnalysis-SeoBacklinkSnapshots table', () => {
  it('keys snapshots by domain and time', () => {
    expect(snapshot.tableKeySchema).toStrictEqual([
      {
        AttributeName: 'domain',
        KeyType: 'HASH',
      },
      {
        AttributeName: 'snapshot_at',
        KeyType: 'RANGE',
      },
    ]);
  });

  it('keeps snapshots: the table has no TTL (TENETS.md, D2 and D5)', () => {
    expect(snapshot.tableTimeToLive).toBeUndefined();
  });

  it('names the table to the router and the jobs function', () => {
    const names = [snapshot.routerEnv, snapshot.jobsEnv].map((env) => env.DYNAMODB_TABLE_SEO_BACKLINK_SNAPSHOTS);

    expect(names).toStrictEqual([{ Ref: expect.stringMatching(/SnapshotsTable/) }, { Ref: expect.stringMatching(/SnapshotsTable/) }]);
  });

  it('lets the router read, put and update snapshot items, never delete one or manage the table', () => {
    expect(snapshot.routerTableActions).toStrictEqual(sharedTableActions({}));
  });
});

describe('Backlink snapshot runs', () => {
  it('runs the snapshot_all step in one task with a timeout and no retry', () => {
    const task = snapshot.states.SnapshotAll;

    expect([
      resolvePath(task, ['Parameters', 'Payload']),
      resolvePath(task, ['TimeoutSeconds']),
      resolvePath(task, ['Retry']),
    ]).toStrictEqual([{
      step: 'backlinks.snapshot_all',
      'scheduled.$': '$.scheduled',
    }, 900, undefined]);
  });

  it('starts the run every Monday at 06:00 UTC as a scheduled run, never retried by the rule', () => {
    const [target] = Array.isArray(snapshot.ruleTargets) ? snapshot.ruleTargets : [];

    expect([snapshot.ruleSchedule, resolvePath(target, ['Input']), resolvePath(target, ['RetryPolicy'])]).toStrictEqual([
      'cron(0 6 ? * MON *)',
      '{"scheduled":true}',
      { MaximumRetryAttempts: 0 },
    ]);
  });

  it('lets the router start and list snapshot runs only', () => {
    expect(snapshot.routerStateMachineActions).toStrictEqual(['states:ListExecutions', 'states:StartExecution']);
  });

  it('gives the router the snapshot state machine to start', () => {
    expect(snapshot.routerEnv.SEO_BACKLINK_SNAPSHOTS_STATE_MACHINE_ARN).toStrictEqual({ Ref: expect.stringMatching(/SnapshotStateMachine/) });
  });

  it('lets the state machine invoke the jobs function and write its logs and traces only', () => {
    expect(snapshot.stateMachineRoleActions).toStrictEqual(JOBS_STATE_MACHINE_ROLE_ACTIONS);
  });
});
