import {
  describe, expect, it
} from 'vitest';
import {
  LAMBDA_SERVICE_ERRORS, resolvePath, retrierErrors
} from './citation-analysis-stack-fixtures';
import { synthesizeSeoStackSnapshot } from './seo-stack-fixtures';

/**
 * `CitationAnalysisSeoStack` (2.43.0): the SEO API and the Google AI Overviews
 * engine live beside the main stack, which sits at the 500-resource limit.
 */
const snapshot = synthesizeSeoStackSnapshot();

describe('CitationAnalysisSeoStack resource budget', () => {
  it('needs no more than the 500 resources CloudFormation allows a stack', () => {
    expect(snapshot.resourceCount).toBeLessThanOrEqual(500);
  });

  it('imports only the user pool and the CORS origin from the main stack, never a layer or version', () => {
    const volatile = snapshot.importValues.filter((name) => /Layer|Version/.test(name));

    expect(volatile).toStrictEqual([]);
    expect(snapshot.importNames).toStrictEqual([
      'CitationAnalysis-CorsOrigin',
      'MainStack:ExportsOutputFnGetAttAuthuserPool02493132Arn8F91F7E6',
    ]);
  });
});

/** Route prefixes of the SEO features; each feature spec pins its own routes. */
const FEATURE_PREFIXES = ['/api/seo/audits', '/api/seo/backlinks', '/api/seo/domains', '/api/seo/indexnow',
  '/api/seo/insights', '/api/seo/lighthouse', '/api/seo/local', '/api/seo/rank-trackers'];

describe('CitationAnalysis-SeoApi', () => {
  it('serves the six base SEO routes; each feature spec pins its own routes', () => {
    const baseRoutes = snapshot.routes.filter(
      (route) => !FEATURE_PREFIXES.some((prefix) => route.split(' ')[1].startsWith(prefix))
    );
    expect(baseRoutes).toStrictEqual([
      'GET /api/seo/account',
      'GET /api/seo/seo-geo',
      'POST /api/seo/keywords/metrics',
      'POST /api/seo/keywords/metrics/lookup',
      'POST /api/seo/keywords/research',
      'POST /api/seo/serp',
    ]);
  });

  it('puts every method except the CORS preflight behind the Cognito user pool authorizer', () => {
    expect(snapshot.routesWithoutCognito).toStrictEqual([]);
  });

  it.each(FEATURE_PREFIXES)('serves %s routes, each behind the Cognito user pool authorizer', (prefix) => {
    const underPrefix = (routes: string[]): string[] => routes.filter((route) => route.split(' ')[1].startsWith(prefix));

    expect(underPrefix(snapshot.routes)).not.toStrictEqual([]);
    expect(underPrefix(snapshot.routesWithoutCognito)).toStrictEqual([]);
  });

  it('leaves the account-level CloudWatch role to the main stack', () => {
    expect(snapshot.template.findResources('AWS::ApiGateway::Account')).toStrictEqual({});
  });

  it('throttles the prod stage at 20 requests a second with bursts of 40', () => {
    expect(snapshot.stageMethodSettings).toStrictEqual([{
      DataTraceEnabled: false,
      HttpMethod: '*',
      ResourcePath: '/*',
      ThrottlingBurstLimit: 40,
      ThrottlingRateLimit: 20,
    }]);
  });

  it('creates no usage plan, whose quota would never apply to Cognito callers without an API key', () => {
    expect(snapshot.template.findResources('AWS::ApiGateway::UsagePlan')).toStrictEqual({});
  });

  it('exposes the stage URL under the stable output key SeoApiUrl', () => {
    expect(Object.keys(snapshot.template.findOutputs('SeoApiUrl'))).toStrictEqual(['SeoApiUrl']);
  });
});

describe('SEO tables', () => {
  it('bills every SEO table per request', () => {
    expect(snapshot.tableBillingModes).toStrictEqual({
      'CitationAnalysis-SeoKeywordMetrics': 'PAY_PER_REQUEST',
      'CitationAnalysis-SeoCache': 'PAY_PER_REQUEST',
      'CitationAnalysis-SeoRankTracking': 'PAY_PER_REQUEST',
      'CitationAnalysis-SeoDomainSnapshots': 'PAY_PER_REQUEST',
      'CitationAnalysis-SeoBacklinkSnapshots': 'PAY_PER_REQUEST',
      'CitationAnalysis-SeoAudits': 'PAY_PER_REQUEST',
    });
  });

  it('expires SeoCache items on their ttl attribute', () => {
    expect(snapshot.cacheTimeToLive).toStrictEqual({ AttributeName: 'ttl', Enabled: true });
  });
});

describe('CitationAnalysis-SeoRouter', () => {
  it('names the SEO tables and the main-stack tables it reads in its environment', () => {
    expect(snapshot.routerEnv).toMatchObject({
      DYNAMODB_TABLE_SEO_KEYWORD_METRICS: { Ref: expect.stringMatching(/^SeoKeywordMetricsTable/) },
      DYNAMODB_TABLE_SEO_CACHE: { Ref: expect.stringMatching(/^SeoCacheTable/) },
      DYNAMODB_TABLE_SEARCH_RESULTS: 'CitationAnalysis-SearchResults',
      DYNAMODB_TABLE_KEYWORDS: 'CitationAnalysis-Keywords',
    });
  });

  it('reads only the main-stack tables its handlers read', () => {
    expect(snapshot.routerMainTables).toStrictEqual([
      'CitationAnalysis-BrandConfig',
      'CitationAnalysis-Keywords',
      'CitationAnalysis-RecommendationStatus',
      'CitationAnalysis-SearchResults',
    ]);
  });

  it('does not name the Citations table, which no SEO handler reads', () => {
    expect(snapshot.routerEnv).not.toHaveProperty('DYNAMODB_TABLE_CITATIONS');
  });

  it('names the bucket, secrets prefix and CORS parameter in its environment', () => {
    expect(snapshot.routerEnv).toMatchObject({
      RAW_RESPONSES_BUCKET: 'citation-analysis-raw-responses-123456789012',
      SECRETS_PREFIX: 'citation-analysis/',
      CORS_ORIGIN_PARAM: '/citation-analysis/cors-origin',
      DYNAMODB_TABLE_BRAND_CONFIG: 'CitationAnalysis-BrandConfig',
    });
  });
});

describe('CitationAnalysis-Search-google_ai_overview', () => {
  it('reserves 5 concurrent executions', () => {
    expect(snapshot.aiOverviewReservedConcurrency).toBe(5);
  });

  it('carries the same environment keys as the main stack provider search functions', () => {
    expect(snapshot.aiOverviewEnvKeys).toStrictEqual(snapshot.mainProviderEnvKeys);
  });
});

describe('Main stack with the seoEngine context', () => {
  it('keeps its resource count when seoEngine is true', () => {
    expect(snapshot.mainResourceCountWithSeoEngine).toBe(snapshot.mainResourceCount);
    expect(snapshot.mainResourceCountWithSeoEngine).toBeLessThanOrEqual(500);
  });

  it('adds the Search-google_ai_overview branch only when seoEngine is true', () => {
    expect(snapshot.mainBranchStarts).not.toContain('Search-google_ai_overview');
    expect(snapshot.mainBranchStartsWithSeoEngine).toStrictEqual([...snapshot.mainBranchStarts, 'Search-google_ai_overview']);
  });

  it('never re-runs a failed Search-google_ai_overview invocation, which would pay DataForSEO again', () => {
    expect(retrierErrors(snapshot.mainSearchTasksWithSeoEngine.google_ai_overview))
      .toStrictEqual([LAMBDA_SERVICE_ERRORS, ['Lambda.TooManyRequestsException']]);
  });

  it('records a failed Search-google_ai_overview invocation as its failed provider row', () => {
    expect(resolvePath(snapshot.mainSearchTasksWithSeoEngine.google_ai_overview, ['Catch']))
      .toStrictEqual([{ ErrorEquals: ['States.ALL'], Next: 'SearchFailed-google_ai_overview' }]);
  });

  it('keeps the States.TaskFailed retrier on every other provider branch when seoEngine is true', () => {
    const others = Object.entries(snapshot.mainSearchTasksWithSeoEngine)
      .filter(([providerId]) => providerId !== 'google_ai_overview');
    const lastRetriers = others.map(([, task]) => resolvePath(task, ['Retry', '3', 'ErrorEquals']));

    expect(others).toHaveLength(10);
    expect(new Set(lastRetriers.map((errors) => JSON.stringify(errors))))
      .toStrictEqual(new Set([JSON.stringify(['States.TaskFailed', 'States.Timeout'])]));
  });
});

describe('Google AI Overviews search role', () => {
  it('may only put and query answers, never delete or batch-write them (TENETS.md, tenet 6 and D5)', () => {
    expect(snapshot.aiOverviewSearchResultsActions).toStrictEqual(['dynamodb:PutItem', 'dynamodb:Query']);
  });

  it('may only read and update its provider config row', () => {
    expect(snapshot.aiOverviewProviderConfigActions).toStrictEqual(['dynamodb:GetItem', 'dynamodb:UpdateItem']);
  });
});
