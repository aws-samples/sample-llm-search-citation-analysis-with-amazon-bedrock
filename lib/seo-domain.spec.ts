import {
  describe, expect, it
} from 'vitest';
import { resolvePath } from './citation-analysis-stack-fixtures';
import { synthesizeSeoDomainSnapshot } from './seo-domain-fixtures';
import { TTL_ON_TTL_ATTRIBUTE } from './seo-feature-fixtures';

/** `SeoDomain`: Domain Overview routes, estimated-traffic snapshots and SEO recommendations. */
const snapshot = synthesizeSeoDomainSnapshot();

describe('SeoDomain routes', () => {
  it('serves the domain and insights routes', () => {
    expect(snapshot.routes).toStrictEqual([
      'GET /api/seo/domains/snapshots',
      'GET /api/seo/insights',
      'POST /api/seo/domains/competitors',
      'POST /api/seo/domains/keywords',
      'POST /api/seo/domains/overview',
      'POST /api/seo/domains/pages',
      'POST /api/seo/domains/snapshots',
    ]);
  });
});

describe('CitationAnalysis-SeoDomainSnapshots table', () => {
  it('keys snapshots by domain#market and time', () => {
    expect(snapshot.tableKeys).toStrictEqual([
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'snapshot_at', KeyType: 'RANGE' },
    ]);
  });

  it('expires snapshots on their ttl attribute', () => {
    expect(snapshot.tableTimeToLive).toStrictEqual(TTL_ON_TTL_ATTRIBUTE);
  });

  it('lets the router read it', () => {
    expect(snapshot.routerTableActions).toStrictEqual(expect.arrayContaining(['dynamodb:Query', 'dynamodb:GetItem']));
  });

  it('never lets the router write it', () => {
    expect(snapshot.routerTableActions.filter((action) => /Put|Update|Delete|Write/.test(action))).toStrictEqual([]);
  });

  it('lets the jobs function write it', () => {
    expect(snapshot.jobsTableActions).toContain('dynamodb:PutItem');
  });
});

describe('CitationAnalysis-SeoDomainSnapshots state machine', () => {
  it('never retries a billed snapshot task', () => {
    expect(resolvePath(snapshot.states.SnapshotOne, ['Retry'])).toBeUndefined();
  });

  it('catches a failed snapshot so the other targets still run', () => {
    expect(resolvePath(snapshot.states.SnapshotOne, ['Catch', '0', 'Next'])).toBe('SnapshotFailed');
  });

  it('bounds both tasks with a timeout', () => {
    expect([resolvePath(snapshot.states.ListTargets, ['TimeoutSeconds']), resolvePath(snapshot.states.SnapshotOne, ['TimeoutSeconds'])])
      .toStrictEqual([60, 300]);
  });

  it('retries only throttles of the free target listing', () => {
    expect(resolvePath(snapshot.states.ListTargets, ['Retry', '0', 'ErrorEquals']))
      .toStrictEqual(['Lambda.TooManyRequestsException', 'Lambda.ServiceException']);
  });

  it('snapshots two targets at a time', () => {
    expect(resolvePath(snapshot.states.SnapshotEach, ['MaxConcurrency'])).toBe(2);
  });
});

describe('Weekly snapshot rule', () => {
  it('runs every Monday at 04:00 UTC', () => {
    expect(snapshot.ruleSchedule).toBe('cron(0 4 ? * MON *)');
  });

  it('starts the sweep with no targets so the job lists every brand domain', () => {
    expect(snapshot.ruleInput).toBe('{}');
  });
});

describe('Function grants and environment', () => {
  it('lets the router start the snapshot state machine and nothing else on it', () => {
    expect(snapshot.routerStateMachineActions).toStrictEqual(['states:StartExecution']);
  });

  it('lets the router only batch-read the Action Center status table', () => {
    expect(snapshot.routerStatusTableActions).toStrictEqual(['dynamodb:BatchGetItem']);
  });

  it('names the snapshot table, state machine and status table in the router environment', () => {
    expect(Object.keys(snapshot.routerEnv)).toStrictEqual(expect.arrayContaining([
      'DYNAMODB_TABLE_SEO_DOMAIN_SNAPSHOTS', 'SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE_ARN', 'DYNAMODB_TABLE_RECOMMENDATION_STATUS',
    ]));
  });

  it('names the snapshot table in the jobs environment', () => {
    expect(snapshot.jobsEnv).toHaveProperty('DYNAMODB_TABLE_SEO_DOMAIN_SNAPSHOTS');
  });
});
