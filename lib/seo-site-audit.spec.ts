import {
  describe, expect, it
} from 'vitest';
import { TTL_ON_TTL_ATTRIBUTE } from './seo-feature-fixtures';
import { synthesizeSiteAuditSnapshot } from './seo-site-audit-fixtures';

/** `SeoSiteAudit`: the site-audit table, state machine, routes and grants of the SEO stack. */
const snapshot = synthesizeSiteAuditSnapshot();

describe('Site audit API routes', () => {
  it('serves start, list, detail, issues, pages and cancel', () => {
    expect(snapshot.routes).toStrictEqual([
      'GET /api/seo/audits',
      'GET /api/seo/audits/{auditId}',
      'GET /api/seo/audits/{auditId}/issues',
      'GET /api/seo/audits/{auditId}/pages',
      'POST /api/seo/audits',
      'POST /api/seo/audits/{auditId}/cancel',
    ]);
  });
});

describe('CitationAnalysis-SeoAudits table', () => {
  it('keys every item by pk and sk', () => {
    expect(snapshot.tableKeys).toStrictEqual(['pk HASH', 'sk RANGE']);
  });

  it('expires frontier URLs through the ttl attribute', () => {
    expect(snapshot.tableTimeToLive).toStrictEqual(TTL_ON_TTL_ATTRIBUTE);
  });

  it('has the GSI1 index for the audit list and frontier claims', () => {
    expect(snapshot.tableIndexes).toStrictEqual([{
      IndexName: 'GSI1',
      KeySchema: [{ AttributeName: 'gsi1pk', KeyType: 'HASH' }, { AttributeName: 'gsi1sk', KeyType: 'RANGE' }],
      Projection: { ProjectionType: 'ALL' },
    }]);
  });
});

describe('CitationAnalysis-SiteAudit state machine', () => {
  it('loops crawl chunks through a choice and a wait between start and finalize', () => {
    expect(snapshot.stateNames).toStrictEqual([
      'AuditFailed', 'CrawlChunk', 'CrawlDone', 'CrawlPause', 'FailAudit', 'FinalizeAudit', 'StartAudit',
    ]);
  });

  it('waits the rate-limit pause the crawl step asks for', () => {
    expect(snapshot.waitSecondsPath).toBe('$.wait_seconds');
  });

  it('sets an explicit timeout on every task', () => {
    const timeouts = Object.fromEntries(Object.entries(snapshot.tasks).map(([name, task]) => [name, task.timeoutSeconds]));

    expect(timeouts).toStrictEqual({ CrawlChunk: 300, FailAudit: 60, FinalizeAudit: 600, StartAudit: 840 });
  });

  it('retries only Lambda service errors, never a step timeout', () => {
    const retried = new Set(Object.values(snapshot.tasks).flatMap((task) => task.retriedErrors));

    expect([...retried].some((error) => error === 'States.Timeout' || error === 'States.ALL')).toBe(false);
  });

  it('retries a crawl chunk at most once', () => {
    expect(snapshot.tasks.CrawlChunk?.maxAttempts).toStrictEqual([1]);
  });

  it('routes every failure of start, crawl and finalize to the fail step', () => {
    const caught = ['StartAudit', 'CrawlChunk', 'FinalizeAudit'].map((name) => snapshot.tasks[name]?.caughtErrors);

    expect(caught).toStrictEqual([['States.ALL'], ['States.ALL'], ['States.ALL']]);
  });

  it('times the whole audit out after four hours', () => {
    expect(snapshot.stateMachineTimeoutSeconds).toBe(14_400);
  });
});

describe('Site audit permissions', () => {
  it('lets the router only start executions of the audit state machine', () => {
    expect(snapshot.routerActionsOnStateMachine).toStrictEqual(['states:StartExecution']);
  });

  it('gives the router no Step Functions action on audits beyond start and stop', () => {
    expect(snapshot.routerStatesActions).toStrictEqual(['states:StartExecution', 'states:StopExecution']);
  });

  it('gives the jobs function no Step Functions action on audits', () => {
    expect(snapshot.jobsStatesActions).toStrictEqual([]);
  });
});

describe('Site audit environment', () => {
  it('names the audit table and the state machine on the router', () => {
    expect(Object.keys(snapshot.routerEnv).filter((key) => key.includes('AUDIT')).sort((left, right) => left.localeCompare(right)))
      .toStrictEqual(['DYNAMODB_TABLE_SEO_AUDITS', 'SITE_AUDIT_STATE_MACHINE_ARN']);
  });

  it('names the audit table on the jobs function', () => {
    expect(Object.keys(snapshot.jobsEnv).filter((key) => key.includes('AUDIT'))).toStrictEqual(['DYNAMODB_TABLE_SEO_AUDITS']);
  });
});
