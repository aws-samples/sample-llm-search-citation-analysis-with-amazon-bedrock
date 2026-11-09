import {
  describe, expect, it
} from 'vitest';
import { DASHBOARD_API_PARAMETERS, RUNTIME_CONFIG_OBJECT_KEY } from './api-stack';
import {
  binAppSource, extractApiStackSnapshot, permissionsOfFunction, synthesizeDashboardStacks
} from './api-stack-fixtures';
import {
  COGNITO_AUTH, allowStatementsOfRole, methodRouteLabels, resolvePath, statementActions
} from './citation-analysis-stack-fixtures';
import { DASHBOARD_API_FUNCTION_NAMES, WILDCARD_PERMISSION_FUNCTION_KEYS } from './constructs/rest-api';
import { LIVE_EVENTS_PARAMETERS } from './constructs/live-events';

/**
 * CitationAnalysisApiStack (2.44.0): the dashboard REST API, moved out of the
 * main stack. One synthesis of both stacks proves the routes, auth, CORS,
 * throttling and permissions moved intact, that the API stack takes no
 * cross-stack reference from the main stack, and that the main stack keeps
 * the exports older API stacks import for one release.
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
  ['CitationAnalysis-API-Exports', 10],
];

/**
 * The CDK auto-exports a 2.45.0-as-built API stack imports, as synthesized
 * from commit 704f0e6e (2.44.0 imported the same but the Exports function's),
 * and the value each holds. The names are what CloudFormation matches.
 */
const LEGACY_API_STACK_EXPORTS: Record<string, unknown> = {
  ExportsOutputFnGetAttAuthuserPool02493132Arn8F91F7E6: { 'Fn::GetAtt': ['AuthuserPool02493132', 'Arn'] },
  ExportsOutputFnGetAttCitationsContentFunction2F1067F9ArnD9974755: { 'Fn::GetAtt': ['CitationsContentFunction2F1067F9', 'Arn'] },
  ExportsOutputFnGetAttConfigMgmtFunctionAB4F8D8DArn0BCAAC19: { 'Fn::GetAtt': ['ConfigMgmtFunctionAB4F8D8D', 'Arn'] },
  ExportsOutputFnGetAttContentStudioFunction121BA1DBArnC354F252: { 'Fn::GetAtt': ['ContentStudioFunction121BA1DB', 'Arn'] },
  ExportsOutputFnGetAttExecutionMgmtFunction026AEF85ArnAC1F1951: { 'Fn::GetAtt': ['ExecutionMgmtFunction026AEF85', 'Arn'] },
  ExportsOutputFnGetAttExportsFunctionC992267AArn7F706B36: { 'Fn::GetAtt': ['ExportsFunctionC992267A', 'Arn'] },
  ExportsOutputFnGetAttGetBrandMentionsFunctionA70EE0B8Arn9478257F: { 'Fn::GetAtt': ['GetBrandMentionsFunctionA70EE0B8', 'Arn'] },
  ExportsOutputFnGetAttGetPersonaRankingsFunction6FDC5C24Arn57086B7C: { 'Fn::GetAtt': ['GetPersonaRankingsFunction6FDC5C24', 'Arn'] },
  ExportsOutputFnGetAttHealthCheckFunctionC4679183ArnFF0231CE: { 'Fn::GetAtt': ['HealthCheckFunctionC4679183', 'Arn'] },
  ExportsOutputFnGetAttKeywordMgmtFunctionC12A3132ArnABE3F59E: { 'Fn::GetAtt': ['KeywordMgmtFunctionC12A3132', 'Arn'] },
  ExportsOutputFnGetAttManageBrandConfigFunction693CF0EBArnFE16647B: { 'Fn::GetAtt': ['ManageBrandConfigFunction693CF0EB', 'Arn'] },
  ExportsOutputFnGetAttManageUsersFunction557A064FArn0A356733: { 'Fn::GetAtt': ['ManageUsersFunction557A064F', 'Arn'] },
  ExportsOutputFnGetAttSelfReflectionFunction51D74BC3ArnED6A416D: { 'Fn::GetAtt': ['SelfReflectionFunction51D74BC3', 'Arn'] },
  ExportsOutputFnGetAttStatsInsightsFunction66C651E5Arn6B838786: { 'Fn::GetAtt': ['StatsInsightsFunction66C651E5', 'Arn'] },
  ExportsOutputFnGetAttWebDistribution59C46482DomainNameC09D0E36: { 'Fn::GetAtt': ['WebDistribution59C46482', 'DomainName'] },
  ExportsOutputRefWebBucket12880F5B704A1ACB: { Ref: 'WebBucket12880F5B' },
  ExportsOutputRefWebDistribution59C46482F5F457E0: { Ref: 'WebDistribution59C46482' },
};

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

  it('authorizes against the user pool whose id the main stack writes to SSM', () => {
    expect(resolvePath(snapshot.authorizers[0], ['ProviderARNs'])).toStrictEqual([{
      'Fn::Join': ['', [
        'arn:', { Ref: 'AWS::Partition' }, ':cognito-idp:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':userpool/',
        { Ref: snapshot.apiSsmParameters[DASHBOARD_API_PARAMETERS.userPoolId].logicalId },
      ]],
    }]);
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
      'Fn::Join': ['', ["'", { Ref: snapshot.apiSsmParameters[DASHBOARD_API_PARAMETERS.corsOrigin].logicalId }, "'"]],
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

  it('grants API Gateway, and only API Gateway, all twenty-eight permissions', () => {
    expect(snapshot.permissions.map((permission) => permission.principal)).toStrictEqual(Array(28).fill('apigateway.amazonaws.com'));
  });

  it('leaves no API Gateway resource and no API Gateway permission in the main stack', () => {
    expect(snapshot.mainApiGatewayResourceTypes).toStrictEqual([]);
    expect(snapshot.mainApiGatewayPermissions).toBe(0);
  });
});

/**
 * 2.45.0 review F11: a cross-stack reference is a CloudFormation export, and
 * CloudFormation refuses to change or remove an export another stack
 * imports, so any import would let a later main-stack change block that
 * stack's deploys. The API stack imports nothing: function ARNs come from
 * fixed names, the rest from SSM parameters resolved at deploy time.
 */
describe('API stack cross-stack references', () => {
  it('imports no export of the main stack', () => {
    expect(snapshot.apiImports).toStrictEqual([]);
  });

  it('reads the dashboard origin, the user pool id, the distribution id and the live events domains from SSM at deploy time', () => {
    const expected = [...Object.values(DASHBOARD_API_PARAMETERS), ...Object.values(LIVE_EVENTS_PARAMETERS)];
    expect(Object.keys(snapshot.apiSsmParameters).sort((left, right) => left.localeCompare(right)))
      .toStrictEqual(expected.sort((left, right) => left.localeCompare(right)));
    expect(Object.values(snapshot.apiSsmParameters).map((parameter) => parameter.type))
      .toStrictEqual(Array(expected.length).fill('AWS::SSM::Parameter::Value<String>'));
  });

  it('reaches the thirteen API functions by the fixed names the main stack gives them', () => {
    expect(snapshot.referencedFunctionNames).toStrictEqual(
      Object.values(DASHBOARD_API_FUNCTION_NAMES).sort((left, right) => left.localeCompare(right)),
    );
    expect(snapshot.referencedFunctionNames.filter((name) => !snapshot.mainFunctionNames.includes(name))).toStrictEqual([]);
  });

  it('is deployed after the main stack, which references nothing of it', () => {
    expect(stacks.api.dependencies).toStrictEqual([stacks.main]);
    expect(stacks.main.dependencies).toStrictEqual([]);
    expect(snapshot.mainTemplateImports).toStrictEqual([]);
  });

  it('gets that order from bin/, which declares the dependency CDK can no longer infer', () => {
    expect(binAppSource()).toContain('apiStack.node.addDependency(stack);');
  });
});

describe('Main stack SSM parameters for the API stack', () => {
  it('writes the user pool id', () => {
    expect(snapshot.mainSsmParameters[DASHBOARD_API_PARAMETERS.userPoolId]).toStrictEqual({ Ref: snapshot.mainUserPoolLogicalId });
  });

  it('writes the dashboard distribution id', () => {
    expect(snapshot.mainSsmParameters[DASHBOARD_API_PARAMETERS.webDistributionId]).toStrictEqual({ Ref: snapshot.mainDistributionLogicalId });
  });

  it('writes the dashboard origin as https:// plus the distribution domain', () => {
    expect(snapshot.mainSsmParameters[DASHBOARD_API_PARAMETERS.corsOrigin]).toStrictEqual({
      'Fn::Join': ['', ['https://', { 'Fn::GetAtt': [snapshot.mainDistributionLogicalId, 'DomainName'] }]],
    });
  });
});

/**
 * Upgrade from 2.44.0 or a 2.45.0 build before F11: the deployed API stack
 * still imports CDK's automatic exports of the main stack, and `cdk deploy
 * --all` updates the main stack first. CloudFormation refuses to remove an
 * export in use, so the main stack keeps every one of them, under the same
 * name, until the next release (then: delete `retainLegacyApiStackExports`).
 * 2.44.0 imported all of these but the Exports function's ARN.
 */
describe('Main stack exports kept for one release', () => {
  it('keeps exactly the exports a 2.44.0 or 2.45.0-as-built API stack imports, under their names', () => {
    expect(snapshot.mainReferenceExports.map((entry) => entry.localName)).toStrictEqual(Object.keys(LEGACY_API_STACK_EXPORTS));
  });

  it('prefixes them with the stack name, as CDK did', () => {
    expect([...new Set(snapshot.mainReferenceExports.map((entry) => entry.prefix))]).toStrictEqual([stacks.main.stackName]);
  });

  it('exports the same values: thirteen function ARNs, the user pool ARN, the bucket name, the distribution id and domain', () => {
    expect(Object.fromEntries(snapshot.mainReferenceExports.map((entry) => [entry.localName, entry.value])))
      .toStrictEqual(LEGACY_API_STACK_EXPORTS);
  });
});

describe('Runtime config (config.json)', () => {
  it('writes the stage URL plus /api and the live events domains into the web bucket root', () => {
    expect(resolvePath(runtimeConfig, ['DestinationBucketName'])).toStrictEqual(snapshot.mainWebBucketName);
    expect(resolvePath(runtimeConfig, ['DestinationBucketKeyPrefix'])).toBeUndefined();
    const markers = JSON.stringify(resolvePath(runtimeConfig, ['SourceMarkers']));
    expect(markers).toMatch(/"\/api\\""\]\]\},"<<marker:0xbaba:1>>"/u);
    expect(markers).toMatch(/liveeventshttpdomain.*liveeventsrealtimedomain/u);
  });

  it('never prunes the bucket and keeps every file when the API stack is deleted', () => {
    expect(resolvePath(runtimeConfig, ['Prune'])).toBe(false);
    expect(resolvePath(runtimeConfig, ['RetainOnDelete'])).toBe(true);
  });

  it('serves config.json as JSON that browsers revalidate, and invalidates it on the distribution', () => {
    expect(resolvePath(runtimeConfig, ['SystemMetadata'])).toStrictEqual({ 'cache-control': 'no-cache', 'content-type': 'application/json' });
    expect(resolvePath(runtimeConfig, ['DistributionPaths'])).toStrictEqual([`/${RUNTIME_CONFIG_OBJECT_KEY}`]);
  });

  it('deploys with a role that can only write config.json and invalidate the dashboard distribution', () => {
    const roles = stacks.apiTemplate.findResources('AWS::IAM::Role', {
      Properties: { Description: 'Writes config.json to the web bucket and invalidates it on the dashboard distribution' },
    });
    const [roleId] = Object.keys(roles);
    const actions = allowStatementsOfRole(stacks.apiTemplate, roleId).flatMap(statementActions).sort((a, b) => a.localeCompare(b));

    expect(actions).toStrictEqual([
      'cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation', 's3:GetObject', 's3:ListBucket', 's3:PutObject',
    ]);
    expect(JSON.stringify(allowStatementsOfRole(stacks.apiTemplate, roleId))).not.toContain('"Resource":"*"');
  });

  it('invalidates the distribution whose id the main stack writes to SSM', () => {
    expect(resolvePath(runtimeConfig, ['DistributionId']))
      .toStrictEqual({ Ref: snapshot.apiSsmParameters[DASHBOARD_API_PARAMETERS.webDistributionId].logicalId });
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
