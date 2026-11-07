import {
  describe, expect, it
} from 'vitest';
import { LAMBDA_SERVICE_ERRORS } from './citation-analysis-stack-fixtures';
import { routedJobWiring } from './seo-feature-fixtures';
import { synthesizeSeoLocalSnapshot } from './seo-local-fixtures';

/** `SeoLocal`: the `/api/seo/local/...` routes and the `CitationAnalysis-SeoLocalJob` state machine. */
const snapshot = synthesizeSeoLocalSnapshot();

describe('SeoLocal routes', () => {
  it('serves the seven local SEO routes', () => {
    expect(snapshot.routes).toStrictEqual([
      'GET /api/seo/local/categories',
      'GET /api/seo/local/jobs/{job_id}',
      'POST /api/seo/local/businesses',
      'POST /api/seo/local/jobs',
      'POST /api/seo/local/profile',
      'POST /api/seo/local/questions',
      'POST /api/seo/local/serp',
    ]);
  });

  it('adds no table of its own: jobs live in the SEO cache', () => {
    expect(snapshot.ownTableIds).toStrictEqual([]);
  });
});

describe('CitationAnalysis-SeoLocalJob', () => {
  it('never retries the post step, which buys the tasks', () => {
    expect(snapshot.taskRetriers.Post).toStrictEqual([]);
  });

  it('retries the free collect step on Lambda service errors', () => {
    expect(snapshot.taskRetriers.Collect).toStrictEqual([LAMBDA_SERVICE_ERRORS]);
  });

  it('gives post, collect and fail the jobs function\'s whole 15 minutes', () => {
    expect(snapshot.taskTimeouts).toStrictEqual({ Post: 900, Collect: 900, Fail: 900 });
  });

  it('waits ten seconds between collections', () => {
    expect(snapshot.states.WaitForResults).toStrictEqual({ Type: 'Wait', Seconds: 10, Next: 'Collect' });
  });

  it('marks the job failed when post or collect crashes', () => {
    expect(snapshot.taskCatchTargets).toStrictEqual({ Post: 'Fail', Collect: 'Fail', Fail: undefined });
  });

  it('stops the whole execution after an hour', () => {
    expect(snapshot.timeoutSeconds).toBe(3600);
  });
});

describe('SeoLocal permissions', () => {
  it('lets the state machine only invoke the jobs function and the router only start it, by SEO_LOCAL_JOB_STATE_MACHINE_ARN', () => {
    expect(snapshot.wiring).toStrictEqual(routedJobWiring('SEO_LOCAL_JOB_STATE_MACHINE_ARN'));
  });
});
