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
const [seoBucketId] = Object.keys(snapshot.template.findResources('AWS::S3::Bucket', {
  Properties: { BucketName: 'citation-analysis-seo-123456789012' },
}));

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
  it('serves the seven base SEO routes; each feature spec pins its own routes', () => {
    const baseRoutes = snapshot.routes.filter(
      (route) => !FEATURE_PREFIXES.some((prefix) => route.split(' ')[1].startsWith(prefix))
    );
    expect(baseRoutes).toStrictEqual([
      'GET /api/seo/account',
      'GET /api/seo/daily-calls',
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

  it('reads only the main-stack tables its handlers read, plus the daily call limit and its audit', () => {
    expect(snapshot.routerMainTables).toStrictEqual([
      'CitationAnalysis-BrandConfig',
      'CitationAnalysis-Keywords',
      'CitationAnalysis-McpState',
      'CitationAnalysis-ProviderConfig',
      'CitationAnalysis-RecommendationStatus',
      'CitationAnalysis-SearchResults',
    ]);
  });

  it('reads only the dataforseo row of ProviderConfig, and only puts audit items in McpState (tenet 6, D4)', () => {
    expect(snapshot.routerLimitStatements.map((statement) => [
      resolvePath(statement, ['Action']), resolvePath(statement, ['Condition']),
    ])).toStrictEqual([
      ['dynamodb:GetItem', { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['dataforseo'] } }],
      ['dynamodb:PutItem', { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['audit#*'] } }],
    ]);
  });

  it('names the ProviderConfig and audit tables the daily call limit uses', () => {
    expect(snapshot.routerEnv).toMatchObject({
      DYNAMODB_TABLE_PROVIDER_CONFIG: 'CitationAnalysis-ProviderConfig',
      DYNAMODB_TABLE_MCP_STATE: 'CitationAnalysis-McpState',
    });
  });

  it('does not name the Citations table, which no SEO handler reads', () => {
    expect(snapshot.routerEnv).not.toHaveProperty('DYNAMODB_TABLE_CITATIONS');
  });

  it('names the SEO bucket, secrets prefix and CORS parameter in its environment, and not the raw-responses bucket', () => {
    expect(snapshot.routerEnv).toMatchObject({
      SEO_BUCKET: { Ref: seoBucketId },
      SECRETS_PREFIX: 'citation-analysis/',
      CORS_ORIGIN_PARAM: '/citation-analysis/cors-origin',
      DYNAMODB_TABLE_BRAND_CONFIG: 'CitationAnalysis-BrandConfig',
    });
    expect(snapshot.routerEnv).not.toHaveProperty('RAW_RESPONSES_BUCKET');
  });
});

describe('citation-analysis-seo bucket', () => {
  const bucket = snapshot.template.findResources('AWS::S3::Bucket')[seoBucketId];

  it('is private, TLS-only through its policy, retained and logged like the main data buckets', () => {
    expect(resolvePath(bucket, ['Properties', 'BucketName'])).toBe('citation-analysis-seo-123456789012');
    expect(resolvePath(bucket, ['Properties', 'PublicAccessBlockConfiguration'])).toStrictEqual({
      BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
    });
    expect(resolvePath(bucket, ['DeletionPolicy'])).toBe('Retain');
    expect(resolvePath(bucket, ['Properties', 'LoggingConfiguration'])).toStrictEqual({
      DestinationBucketName: 'citation-analysis-access-logs-123456789012', LogFilePrefix: 'seo/',
    });
  });

  it('may be listed by the router and the jobs, so a missing object reads as NoSuchKey instead of AccessDenied', () => {
    const listers = Object.values(snapshot.template.findResources('AWS::IAM::Policy'))
      .filter((policy) => JSON.stringify(resolvePath(policy, ['Properties', 'PolicyDocument', 'Statement'])).includes('"s3:ListBucket"'))
      .filter((policy) => JSON.stringify(resolvePath(policy, ['Properties', 'PolicyDocument'])).includes(`"${seoBucketId}"`));

    expect(listers).toHaveLength(2);
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

describe('Main workflow and the Google AI Overviews engine (always deployed together, no flag)', () => {
  it('stays within CloudFormation\'s 500-resource limit with the engine branch', () => {
    expect(snapshot.mainResourceCount).toBeLessThanOrEqual(500);
  });

  it('always has the Search-google_ai_overview branch, after the ten providers the main stack owns', () => {
    expect(snapshot.mainBranchStarts).toHaveLength(11);
    expect(snapshot.mainBranchStarts.at(-1)).toBe('Search-google_ai_overview');
  });

  it('never re-runs a failed Search-google_ai_overview invocation, which would pay DataForSEO again', () => {
    expect(retrierErrors(snapshot.mainSearchTasks.google_ai_overview))
      .toStrictEqual([LAMBDA_SERVICE_ERRORS, ['Lambda.TooManyRequestsException']]);
  });

  it('records a failed row naming the missing function when the SEO stack is not deployed', () => {
    expect(resolvePath(snapshot.mainSearchTasks.google_ai_overview, ['Catch'])).toStrictEqual([
      { ErrorEquals: ['Lambda.ResourceNotFoundException'], Next: 'NotDeployed-google_ai_overview' },
      { ErrorEquals: ['States.ALL'], Next: 'SearchFailed-google_ai_overview' },
    ]);
    expect(resolvePath(snapshot.aiOverviewNotDeployedState, ['Result', 'results', '0'])).toMatchObject({
      provider: 'google_ai_overview',
      status: 'error',
      error: 'CitationAnalysis-Search-google_ai_overview is not deployed',
    });
  });

  it('keeps the States.TaskFailed retrier and the single failed-row catch on every other provider branch', () => {
    const others = Object.entries(snapshot.mainSearchTasks)
      .filter(([providerId]) => providerId !== 'google_ai_overview');
    const lastRetriers = others.map(([, task]) => resolvePath(task, ['Retry', '3', 'ErrorEquals']));
    const catches = others.map(([providerId, task]) => [providerId, resolvePath(task, ['Catch'])]);

    expect(others).toHaveLength(10);
    expect(new Set(lastRetriers.map((errors) => JSON.stringify(errors))))
      .toStrictEqual(new Set([JSON.stringify(['States.TaskFailed', 'States.Timeout'])]));
    expect(catches).toStrictEqual(others.map(([providerId]) => [
      providerId, [{ ErrorEquals: ['States.ALL'], Next: `SearchFailed-${providerId}` }],
    ]));
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

describe('SEO grants, per action (TENETS.md, tenet 6, D1 and D5)', () => {
  it('lets the AI Overviews search role only put raw answers, never delete one', () => {
    expect(snapshot.aiOverviewS3Actions).toStrictEqual(['s3:PutObject']);
  });

  it('never lets the router delete stored keyword metrics or cache entries', () => {
    expect([...snapshot.routerKeywordMetricsActions, ...snapshot.routerCacheActions].filter((action) => action.includes('Delete'))).toStrictEqual([]);
    expect(snapshot.routerKeywordMetricsActions).toContain('dynamodb:BatchWriteItem');
  });
});
