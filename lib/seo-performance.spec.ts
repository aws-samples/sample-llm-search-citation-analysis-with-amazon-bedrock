import {
  describe, expect, it
} from 'vitest';
import { LAMBDA_SERVICE_ERRORS, resolvePath } from './citation-analysis-stack-fixtures';
import { routedJobWiring } from './seo-feature-fixtures';
import { synthesizeSeoPerformanceSnapshot } from './seo-performance-fixtures';

/** `SeoPerformance`: the Lighthouse and IndexNow routes and the `CitationAnalysis-SeoLighthouse` state machine. */
const snapshot = synthesizeSeoPerformanceSnapshot();

describe('SeoPerformance routes', () => {
  it('serves the Lighthouse and IndexNow routes', () => {
    expect(snapshot.routes).toStrictEqual([
      'GET /api/seo/indexnow',
      'GET /api/seo/lighthouse',
      'GET /api/seo/lighthouse/{run_id}',
      'GET /api/seo/lighthouse/sample',
      'POST /api/seo/indexnow/check',
      'POST /api/seo/indexnow/key',
      'POST /api/seo/indexnow/submit',
      'POST /api/seo/lighthouse',
      'POST /api/seo/lighthouse/batch',
    ]);
  });

  it('puts every route behind the Cognito authorizer', () => {
    expect(snapshot.authorizationTypes).toStrictEqual(['COGNITO_USER_POOLS']);
  });

  it('adds no table or function of its own', () => {
    expect(snapshot.ownResourceIds).toStrictEqual([]);
  });
});

describe('CitationAnalysis-SeoLighthouse', () => {
  it('starts with the measure step', () => {
    expect(snapshot.startAt).toBe('Measure');
  });

  it('never retries the measure step, which buys a Lighthouse report', () => {
    expect(snapshot.taskRetriers.Measure).toStrictEqual([]);
  });

  it('retries the free fail step on Lambda service errors', () => {
    expect(snapshot.taskRetriers.Fail).toStrictEqual([LAMBDA_SERVICE_ERRORS]);
  });

  it('gives the measure step five minutes and the fail step one', () => {
    expect(snapshot.taskTimeouts).toStrictEqual({ Measure: 300, Fail: 60 });
  });

  it('marks the run failed when the measure step crashes', () => {
    expect(snapshot.taskCatchTargets).toStrictEqual({ Measure: 'Fail', Fail: undefined });
  });

  it('measures again until the step answers done', () => {
    expect(resolvePath(snapshot.states.AllMeasured, ['Default'])).toBe('Measure');
  });

  it('stops the whole execution after two hours', () => {
    expect(snapshot.timeoutSeconds).toBe(7200);
  });
});

describe('SeoPerformance permissions', () => {
  it('lets the state machine only invoke the jobs function and the router only start it, by SEO_LIGHTHOUSE_STATE_MACHINE_ARN', () => {
    expect(snapshot.wiring).toStrictEqual(routedJobWiring('SEO_LIGHTHOUSE_STATE_MACHINE_ARN'));
  });
});
