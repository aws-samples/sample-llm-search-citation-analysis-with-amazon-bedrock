import {
  describe, expect, it
} from 'vitest';
import { RUNTIME_CONFIG_OBJECT_KEY } from './api-stack';
import {
  extractApiStackSnapshot, permissionsOfFunction, synthesizeDashboardStacks
} from './api-stack-fixtures';
import {
  COGNITO_AUTH, methodRouteLabels, resolvePath
} from './citation-analysis-stack-fixtures';
import { WILDCARD_PERMISSION_FUNCTION_KEYS } from './constructs/rest-api';

/**
 * CitationAnalysisApiStack (2.44.0): the dashboard REST API, moved out of the
 * main stack. One synthesis of both stacks proves the routes, auth, CORS,
 * throttling and permissions moved intact, and that the cross-stack
 * references are exports CloudFormation can keep: stable values only, and
 * only from the main stack to this one.
 */
const stacks = synthesizeDashboardStacks('ApiStackTest');
const snapshot = extractApiStackSnapshot(stacks);
const devSnapshot = extractApiStackSnapshot(synthesizeDashboardStacks('ApiStackDevTest', { dev: 'true' }));

const ROUTER_FUNCTION_NAMES: Record<string, string> = {
  'stats-insights': 'CitationAnalysis-API-StatsInsights',
  'citations-content': 'CitationAnalysis-API-CitationsContent',
  'keyword-mgmt': 'CitationAnalysis-API-KeywordMgmt',
  'config-mgmt': 'CitationAnalysis-API-ConfigMgmt',
  'execution-mgmt': 'CitationAnalysis-API-ExecutionMgmt',
  'brand-config': 'CitationAnalysis-API-ManageBrandConfig',
  'content-studio': 'CitationAnalysis-API-ContentStudio',
  users: 'CitationAnalysis-API-ManageUsers',
};

/** Functions behind one or two routes keep CDK's permissions: one per method for the stage, one for test invoke. */
const PER_METHOD_PERMISSION_COUNTS: [string, number][] = [
  ['CitationAnalysis-API-Health', 2],
  ['CitationAnalysis-API-GetBrandMentions', 2],
  ['CitationAnalysis-API-GetPersonaRankings', 2],
  ['CitationAnalysis-API-SelfReflection', 4],
];

const STABLE_IMPORT_TYPES = ['AWS::CloudFront::Distribution', 'AWS::Cognito::UserPool', 'AWS::Lambda::Function', 'AWS::S3::Bucket'];

const [runtimeConfig] = snapshot.runtimeConfigDeployments;

describe('API stack routes', () => {
  it('leaves only GET /api/health without the Cognito authorizer', () => {
    const open = snapshot.routes.filter((route) => route.authorizationType !== COGNITO_AUTH);

    expect(methodRouteLabels(open)).toStrictEqual(['GET /api/health']);
    expect(open.map((route) => route.authorizationType)).toStrictEqual(['NONE']);
  });

  it('puts every other route behind the single authorizer of the stack', () => {
    const guarded = snapshot.routes.filter((route) => route.authorizationType === COGNITO_AUTH);

    expect(guarded.length).toBeGreaterThan(100);
    expect(new Set(guarded.map((route) => route.authorizerId)).size).toBe(1);
    expect(snapshot.authorizers).toHaveLength(1);
  });

  it('authorizes against the user pool of the main stack', () => {
    expect(resolvePath(snapshot.authorizers[0], ['ProviderARNs'])).toStrictEqual([
      { 'Fn::ImportValue': expect.stringMatching(/:ExportsOutputFnGetAttAuthuserPool\w+Arn\w+$/) },
    ]);
  });

  it('answers a CORS preflight on every resource and on the root', () => {
    expect(snapshot.preflightCount).toBe(snapshot.resourceCount + 1);
  });

  /** ~315 resources in 2.44.0; a route costs 1-3 (resource, method, preflight). */
  it('stays within a budget of 400 resources, under the 500-resource CloudFormation limit', () => {
    expect(Object.keys(stacks.apiTemplate.toJSON().Resources ?? {}).length).toBeLessThanOrEqual(400);
  });
});

describe('API stack throttling', () => {
  it('throttles every method of the prod stage at 100 rps with a 200 burst, metrics on and data trace off', () => {
    expect(snapshot.stageMethodSettings).toStrictEqual([{
      DataTraceEnabled: false,
      HttpMethod: '*',
      MetricsEnabled: true,
      ResourcePath: '/*',
      ThrottlingBurstLimit: 200,
      ThrottlingRateLimit: 100,
    }]);
  });

  it('keeps the usage plan throttle and its 10,000 requests a day quota', () => {
    expect(snapshot.usagePlans).toHaveLength(1);
    expect(resolvePath(snapshot.usagePlans[0], ['Throttle'])).toStrictEqual({ BurstLimit: 200, RateLimit: 100 });
    expect(resolvePath(snapshot.usagePlans[0], ['Quota'])).toStrictEqual({ Limit: 10000, Period: 'DAY' });
  });

  it('defines no API Gateway account, so it does not take over the account CloudWatch role', () => {
    expect(snapshot.apiGatewayAccounts).toBe(0);
  });
});

describe('API stack gateway responses', () => {
  it('exposes auth and integration failures to the dashboard origin only', () => {
    const dashboardOrigin = {
      'Fn::Join': ['', ["'https://", { 'Fn::ImportValue': expect.stringMatching(/:ExportsOutputFnGetAttWebDistribution\w+DomainName\w+$/) }, "'"]],
    };

    expect(snapshot.gatewayResponseOrigins).toStrictEqual(Array(5).fill(dashboardOrigin));
  });

  it('exposes them to every origin in dev mode', () => {
    expect(devSnapshot.gatewayResponseOrigins).toStrictEqual(Array(5).fill("'*'"));
  });
});

describe('API stack invoke permissions', () => {
  it.each(WILDCARD_PERMISSION_FUNCTION_KEYS)('grants the %s router one permission for the whole API', (key) => {
    const permissions = permissionsOfFunction(snapshot, ROUTER_FUNCTION_NAMES[key]);

    expect(permissions).toHaveLength(1);
    expect(permissions[0].sourceArn).toContain('/*/*/*');
  });

  it.each(PER_METHOD_PERMISSION_COUNTS)('grants %s one permission per method and stage', (functionName, count) => {
    const permissions = permissionsOfFunction(snapshot, functionName);

    expect(permissions).toHaveLength(count);
    expect(permissions.filter((permission) => permission.sourceArn.includes('/test-invoke-stage/'))).toHaveLength(count / 2);
  });

  it('grants API Gateway, and only API Gateway, all eighteen permissions', () => {
    expect(snapshot.permissions.map((permission) => permission.principal)).toStrictEqual(Array(18).fill('apigateway.amazonaws.com'));
  });

  it('leaves no API Gateway resource and no API Gateway permission in the main stack', () => {
    expect(snapshot.mainApiGatewayResourceTypes).toStrictEqual([]);
    expect(snapshot.mainApiGatewayPermissions).toBe(0);
  });
});

/**
 * Cross-stack references are exports of the main stack. CloudFormation
 * refuses to change or remove an export another stack imports, so every
 * imported value must be one that never changes for its resource: an ARN or
 * name the main stack fixes, never a layer version (rebuilt on every deploy
 * that touches `lambda/shared/`).
 */
describe('API stack cross-stack references', () => {
  it('imports only functions, the user pool, the distribution and the web bucket', () => {
    expect([...new Set(snapshot.imports.map((entry) => entry.targetType))].sort((left, right) => left.localeCompare(right)))
      .toStrictEqual(STABLE_IMPORT_TYPES);
  });

  it('imports the twelve API functions, each by the fixed name its ARN is built from', () => {
    const functionNames = snapshot.imports
      .filter((entry) => entry.targetType === 'AWS::Lambda::Function')
      .map((entry) => entry.fixedName);

    expect(functionNames).toHaveLength(12);
    expect(functionNames.filter((name) => typeof name !== 'string' || !name.startsWith('CitationAnalysis-API-'))).toStrictEqual([]);
  });

  it('imports the web bucket, whose name the main stack fixes per account', () => {
    expect(snapshot.imports.filter((entry) => entry.targetType === 'AWS::S3::Bucket').map((entry) => entry.fixedName)).toStrictEqual([
      { 'Fn::Join': ['', ['citation-analysis-web-', { Ref: 'AWS::AccountId' }]] },
    ]);
  });

  it('imports no layer and no version', () => {
    expect(snapshot.imports.filter((entry) => /Layer|Version/.test(entry.exportName))).toStrictEqual([]);
  });

  it('is deployed after the main stack, which references nothing of it', () => {
    expect(stacks.api.dependencies).toStrictEqual([stacks.main]);
    expect(stacks.main.dependencies).toStrictEqual([]);
    expect(snapshot.mainTemplateImports).toStrictEqual([]);
  });
});

describe('Runtime config (config.json)', () => {
  it('writes the stage URL plus /api into the web bucket root', () => {
    expect(resolvePath(runtimeConfig, ['DestinationBucketName'])).toStrictEqual({
      'Fn::ImportValue': expect.stringMatching(/:ExportsOutputRefWebBucket\w+$/),
    });
    expect(resolvePath(runtimeConfig, ['DestinationBucketKeyPrefix'])).toBeUndefined();
    expect(JSON.stringify(resolvePath(runtimeConfig, ['SourceMarkers']))).toMatch(/"\/api\\""\]\]\}\}\]$/);
  });

  it('never prunes the bucket and keeps every file when the API stack is deleted', () => {
    expect(resolvePath(runtimeConfig, ['Prune'])).toBe(false);
    expect(resolvePath(runtimeConfig, ['RetainOnDelete'])).toBe(true);
  });

  it('serves config.json as JSON that browsers revalidate, and invalidates it on the distribution', () => {
    expect(resolvePath(runtimeConfig, ['SystemMetadata'])).toStrictEqual({ 'cache-control': 'no-cache', 'content-type': 'application/json' });
    expect(resolvePath(runtimeConfig, ['DistributionPaths'])).toStrictEqual([`/${RUNTIME_CONFIG_OBJECT_KEY}`]);
  });

  it('is left alone by the main stack web deployment, which neither uploads nor prunes it', () => {
    expect(resolvePath(snapshot.mainWebDeployment, ['Exclude'])).toStrictEqual(['config.json']);
    expect(resolvePath(snapshot.mainWebDeployment, ['Prune'])).toBe(false);
  });
});

describe('API stack outputs', () => {
  it('exports the API URL under the export name the main stack used for it', () => {
    expect(resolvePath(snapshot.outputs, ['ApiGatewayUrl', 'Export', 'Name'])).toBe('CitationAnalysis-ApiGatewayUrl');
    expect(snapshot.mainOutputKeys).not.toContain('ApiGatewayUrl');
  });
});
