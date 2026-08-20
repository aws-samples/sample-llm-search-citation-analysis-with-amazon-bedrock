import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  describe, it, expect, beforeAll
} from 'vitest';
import { CitationAnalysisStack } from './citation-analysis-stack';

const KEYWORD_MGMT_FUNCTION_NAME = 'CitationAnalysis-API-KeywordMgmt';
const CONTENT_STUDIO_FUNCTION_NAME = 'CitationAnalysis-API-ContentStudio';
const SELF_INVOKING_CONCURRENCY = 10;
const PREFLIGHT_METHOD = 'OPTIONS';

const PUBLIC_ROUTE = '/api/health';
const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const COGNITO_AUTH = 'COGNITO_USER_POOLS';
const ONE_HOUR_IN_MINUTES = 60;
const SEVEN_DAYS_IN_MINUTES = 7 * 24 * 60;

const API_FUNCTION_PREFIX = 'CitationAnalysis-API-';
const SEARCH_ROLE_NAME = 'CitationAnalysis-SearchLambdaRole';
const PROVIDER_CONFIG_TABLE_NAME = 'CitationAnalysis-ProviderConfig';
const RETENTION_DAYS = 30;
const RETAIN = 'Retain';
const DELETED_API_WAF_NAME = 'CitationAnalysis-API-WAF';
const SCREENSHOTS_BUCKET_PREFIX = 'citation-analysis-screenshots';
const ACCESS_LOGS_BUCKET_PREFIX = 'citation-analysis-access-logs';
const IA_STORAGE_CLASS = 'STANDARD_IA';
const IA_TRANSITION_DAYS = 90;
const ACCESS_LOGS_EXPIRY_DAYS = 90;

interface ApiGatewayMethodSnapshot {
  httpMethod: string;
  integrationType: string;
  integrationUri: string;
  authorizationType: string;
  authorizerId: string;
}

interface ApiMethodAuthSnapshot {
  path: string;
  httpMethod: string;
  authorizationType: string;
  authorizerId: string;
}

interface LambdaLogGroupSnapshot {
  functionName: string;
  logGroupName: string;
  retentionDays: number;
  deletionPolicy: string;
}

interface StateMachineLoggingSnapshot {
  level: string;
  includesExecutionData: boolean;
  destinationRetentionDays: number;
}

interface StageMethodSettingSnapshot {
  resourcePath: string;
  httpMethod: string;
  metricsEnabled: boolean;
  dataTraceEnabled: boolean;
}

interface WebAclSnapshot {
  logicalId: string;
  name: string;
  scope: string;
  associated: boolean;
}

interface StorageClassTransition {
  storageClass: string;
  days: number;
}

interface BucketLifecycleSnapshot {
  transitions: StorageClassTransition[];
  expirationDays: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Walk a nested unknown structure without unsafe member access. */
function resolvePath(root: unknown, keys: string[]): unknown {
  return keys.reduce<unknown>(
    (current, key) => (isRecord(current) ? current[key] : undefined),
    root
  );
}

function resolveString(root: unknown, keys: string[]): string {
  const value = resolvePath(root, keys);
  return typeof value === 'string' ? value : '';
}

/**
 * Extract the Step Functions definition JSON from the synthesized template.
 * Fn::Join produces ["", [...parts]]; string parts are concatenated and
 * object refs replaced with a placeholder.
 */
function extractStateMachineDefinition(template: Template): string {
  const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
  const logicalId = Object.keys(stateMachines)[0];
  const joinArgs = resolvePath(stateMachines[logicalId], ['Properties', 'DefinitionString', 'Fn::Join']);
  const parts = Array.isArray(joinArgs) && Array.isArray(joinArgs[1]) ? joinArgs[1] : [];
  return parts
    .map((part) => (typeof part === 'string' ? part : '"__REF__"'))
    .join('');
}

function extractLambdaEnvVars(template: Template, functionName: string): Record<string, unknown> {
  const lambdas = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  const logicalId = Object.keys(lambdas)[0];
  const envVars = resolvePath(lambdas[logicalId], ['Properties', 'Environment', 'Variables']);
  return isRecord(envVars) ? envVars : {};
}

/** Collect every logical ID referenced by an Fn::GetAtt anywhere in a node. */
function collectGetAttTargets(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectGetAttTargets(item, found);
    return found;
  }
  if (isRecord(node)) {
    const getAtt = node['Fn::GetAtt'];
    if (Array.isArray(getAtt) && typeof getAtt[0] === 'string') {
      found.push(getAtt[0]);
    }
    for (const value of Object.values(node)) collectGetAttTargets(value, found);
  }
  return found;
}

/**
 * Map functionName -> Timeout for every Lambda reachable from an API Gateway
 * method integration.
 *
 * Derived from the template rather than a hand-written list so a newly added
 * API function is covered automatically — a list would silently omit it, which
 * is the failure mode this invariant exists to prevent.
 */
function extractApiBackedFunctionTimeouts(template: Template): Record<string, number> {
  const byLogicalId = new Map<string, { name: string; timeout: number }>();
  for (const [logicalId, resource] of Object.entries(
    template.findResources('AWS::Lambda::Function')
  )) {
    const name = resolvePath(resource, ['Properties', 'FunctionName']);
    const timeout = resolvePath(resource, ['Properties', 'Timeout']);
    if (typeof name === 'string' && typeof timeout === 'number') {
      byLogicalId.set(logicalId, { name, timeout });
    }
  }

  const timeouts: Record<string, number> = {};
  for (const method of Object.values(template.findResources('AWS::ApiGateway::Method'))) {
    const uri = resolvePath(method, ['Properties', 'Integration', 'Uri']);
    for (const logicalId of collectGetAttTargets(uri)) {
      const fn = byLogicalId.get(logicalId);
      if (fn) timeouts[fn.name] = fn.timeout;
    }
  }
  return timeouts;
}

/**
 * Read a function's ReservedConcurrentExecutions, or undefined when uncapped.
 */
function extractReservedConcurrency(
  template: Template,
  functionName: string
): number | undefined {
  const lambdas = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  const logicalId = Object.keys(lambdas)[0];
  const value = resolvePath(lambdas[logicalId], ['Properties', 'ReservedConcurrentExecutions']);
  return typeof value === 'number' ? value : undefined;
}

function findLambdaLogicalId(template: Template, functionName: string): string {
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  return Object.keys(functions)[0] ?? '';
}

function findApiResourceId(template: Template, pathPart: string, parentId?: string): string {
  const resources = template.findResources('AWS::ApiGateway::Resource');
  return Object.entries(resources).find(([, resource]) => {
    const resourcePathPart = resolveString(resource, ['Properties', 'PathPart']);
    const resourceParentId = resolveString(resource, ['Properties', 'ParentId', 'Ref']);
    return resourcePathPart === pathPart && (parentId === undefined || resourceParentId === parentId);
  })?.[0] ?? '';
}

/**
 * Map every AWS::ApiGateway::Resource logical ID to its full path.
 *
 * Resources form a parent chain terminating at the RestApi's RootResourceId,
 * which arrives as an Fn::GetAtt rather than a Ref to a Resource — that is what
 * ends the walk.
 */
function buildResourcePaths(template: Template): Map<string, string> {
  const resources = template.findResources('AWS::ApiGateway::Resource');
  const paths = new Map<string, string>();

  const resolveFor = (logicalId: string): string => {
    const cached = paths.get(logicalId);
    if (cached !== undefined) return cached;

    const resource = resources[logicalId];
    const pathPart = resolveString(resource, ['Properties', 'PathPart']);
    const parentId = resolveString(resource, ['Properties', 'ParentId', 'Ref']);
    const prefix = parentId !== '' && parentId in resources ? resolveFor(parentId) : '';
    const fullPath = `${prefix}/${pathPart}`;

    paths.set(logicalId, fullPath);
    return fullPath;
  };

  Object.keys(resources).forEach(resolveFor);
  return paths;
}

/**
 * Snapshot the authorization configuration of every method in the API.
 *
 * OPTIONS is excluded: CORS preflight carries no Authorization header, so it
 * is unauthenticated by necessity, and counting it would drown the signal.
 */
function extractApiAuthSnapshots(template: Template): ApiMethodAuthSnapshot[] {
  const paths = buildResourcePaths(template);
  const methods = template.findResources('AWS::ApiGateway::Method');

  return Object.values(methods).flatMap((method) => {
    const httpMethod = resolveString(method, ['Properties', 'HttpMethod']);
    if (httpMethod === PREFLIGHT_METHOD) return [];

    const resourceId = resolveString(method, ['Properties', 'ResourceId', 'Ref']);
    return [{
      path: paths.get(resourceId) ?? '/',
      httpMethod,
      authorizationType: resolveString(method, ['Properties', 'AuthorizationType']),
      authorizerId: resolveString(method, ['Properties', 'AuthorizerId', 'Ref']),
    }];
  });
}

/**
 * Convert a Cognito token validity into minutes.
 *
 * CDK picks the serialized unit itself, so asserting on the raw number would
 * pin an implementation detail rather than the security property. Normalizing
 * lets the tests state the actual intended lifetime.
 */
function tokenValidityMinutes(
  clientProps: Record<string, unknown>,
  token: 'Access' | 'Id' | 'Refresh'
): number {
  const raw = clientProps[`${token}TokenValidity`];
  if (typeof raw !== 'number') return Number.NaN;

  const unit = resolveString(clientProps, ['TokenValidityUnits', `${token}Token`]);
  const perUnit: Record<string, number> = {
    seconds: 1 / 60, minutes: 1, hours: 60, days: 1440,
  };

  return raw * (perUnit[unit] ?? Number.NaN);
}

function extractUserPoolClientProps(template: Template): Record<string, unknown> {
  const clients = template.findResources('AWS::Cognito::UserPoolClient');
  const logicalId = Object.keys(clients)[0];
  const props = resolvePath(clients[logicalId], ['Properties']);
  return isRecord(props) ? props : {};
}

function extractUserPoolGroupNames(template: Template): string[] {
  const groups = template.findResources('AWS::Cognito::UserPoolGroup');
  return Object.values(groups)
    .map((group) => resolveString(group, ['Properties', 'GroupName']))
    .sort((left, right) => left.localeCompare(right));
}

function extractApiMethods(template: Template, resourceId: string): ApiGatewayMethodSnapshot[] {
  const methods = template.findResources('AWS::ApiGateway::Method');
  return Object.values(methods).flatMap((method) => {
    const httpMethod = resolveString(method, ['Properties', 'HttpMethod']);
    const methodResourceId = resolveString(method, ['Properties', 'ResourceId', 'Ref']);
    if (methodResourceId !== resourceId || httpMethod === PREFLIGHT_METHOD) return [];

    const integrationUri = resolvePath(method, ['Properties', 'Integration', 'Uri']);
    return [{
      httpMethod,
      integrationType: resolveString(method, ['Properties', 'Integration', 'Type']),
      integrationUri: JSON.stringify(integrationUri) ?? '',
      authorizationType: resolveString(method, ['Properties', 'AuthorizationType']),
      authorizerId: resolveString(method, ['Properties', 'AuthorizerId', 'Ref']),
    }];
  });
}

function retentionDaysOf(logGroups: Record<string, unknown>, logicalId: string): number {
  const days = resolvePath(logGroups[logicalId], ['Properties', 'RetentionInDays']);
  return typeof days === 'number' ? days : Number.NaN;
}

/**
 * Snapshot the log group wired to every Lambda whose FunctionName starts with
 * `prefix`.
 *
 * A function with no LoggingConfig at all is still returned, carrying NaN
 * retention and an empty deletion policy. That state — no log group in the
 * template, so the Lambda service auto-creates one that never expires — is
 * precisely what this suite exists to catch, and skipping those rows would
 * shrink the offender list to nothing and turn the assertions green.
 */
function extractLambdaLogGroups(template: Template, prefix: string): LambdaLogGroupSnapshot[] {
  const logGroups = template.findResources('AWS::Logs::LogGroup');

  return Object.values(template.findResources('AWS::Lambda::Function')).flatMap((fn) => {
    const functionName = resolvePath(fn, ['Properties', 'FunctionName']);
    if (typeof functionName !== 'string' || !functionName.startsWith(prefix)) return [];

    const logicalId = resolveString(fn, ['Properties', 'LoggingConfig', 'LogGroup', 'Ref']);
    const logGroup: unknown = logGroups[logicalId];

    return [{
      functionName,
      logGroupName: resolveString(logGroup, ['Properties', 'LogGroupName']),
      retentionDays: retentionDaysOf(logGroups, logicalId),
      deletionPolicy: resolveString(logGroup, ['DeletionPolicy']),
    }];
  });
}

/** Retention of a log group looked up by its physical name, NaN when absent. */
function retentionForLogGroupName(template: Template, logGroupName: string): number {
  const groups = template.findResources('AWS::Logs::LogGroup', {
    Properties: { LogGroupName: logGroupName },
  });
  return retentionDaysOf(groups, Object.keys(groups)[0] ?? '');
}

/**
 * Read the state machine's logging configuration, resolving the destination
 * back to the log group it points at so retention can be asserted too.
 */
function extractStateMachineLogging(template: Template): StateMachineLoggingSnapshot {
  const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
  const config = resolvePath(
    stateMachines[Object.keys(stateMachines)[0] ?? ''],
    ['Properties', 'LoggingConfiguration']
  );

  const destinations = resolvePath(config, ['Destinations']);
  const destination = Array.isArray(destinations) ? destinations[0] : undefined;
  const [groupLogicalId] = collectGetAttTargets(destination);

  return {
    level: resolveString(config, ['Level']),
    includesExecutionData: resolvePath(config, ['IncludeExecutionData']) === true,
    destinationRetentionDays: retentionDaysOf(
      template.findResources('AWS::Logs::LogGroup'),
      groupLogicalId ?? ''
    ),
  };
}

function extractProdStageMethodSettings(template: Template): StageMethodSettingSnapshot[] {
  const stages = template.findResources('AWS::ApiGateway::Stage', {
    Properties: { StageName: 'prod' },
  });
  const settings = resolvePath(
    stages[Object.keys(stages)[0] ?? ''],
    ['Properties', 'MethodSettings']
  );

  return (Array.isArray(settings) ? settings : []).map((setting) => ({
    resourcePath: resolveString(setting, ['ResourcePath']),
    httpMethod: resolveString(setting, ['HttpMethod']),
    metricsEnabled: resolvePath(setting, ['MetricsEnabled']) === true,
    dataTraceEnabled: resolvePath(setting, ['DataTraceEnabled']) === true,
  }));
}

/**
 * Snapshot every Web ACL together with whether anything is actually bound to
 * it.
 *
 * `associated` is the property that matters: an unbound ACL bills for itself
 * and every rule group it carries while inspecting no requests, which is the
 * state the deleted API Gateway ACL sat in.
 */
function extractWebAcls(template: Template): WebAclSnapshot[] {
  const boundAclIds = new Set(
    Object.values(template.findResources('AWS::WAFv2::WebACLAssociation'))
      .flatMap((association) =>
        collectGetAttTargets(resolvePath(association, ['Properties', 'WebACLArn'])))
  );

  return Object.entries(template.findResources('AWS::WAFv2::WebACL')).map(([logicalId, acl]) => ({
    logicalId,
    name: resolveString(acl, ['Properties', 'Name']),
    scope: resolveString(acl, ['Properties', 'Scope']),
    associated: boundAclIds.has(logicalId),
  }));
}

/**
 * Split a bucket's lifecycle rules into transitions and expirations.
 *
 * Kept as two separate lists rather than a boolean so a test can state both
 * "objects move to cheaper storage" and "nothing is ever deleted" without
 * either claim resting on the other.
 *
 * The bucket is located by a substring of its name because BucketName
 * interpolates the account: a literal in a real synth, an Fn::Join in this one.
 */
function extractBucketLifecycle(template: Template, namePrefix: string): BucketLifecycleSnapshot {
  const [bucket] = Object.values(template.findResources('AWS::S3::Bucket'))
    .filter((candidate) =>
      JSON.stringify(resolvePath(candidate, ['Properties', 'BucketName'])).includes(namePrefix));

  const rules = resolvePath(bucket, ['Properties', 'LifecycleConfiguration', 'Rules']);
  const ruleList = Array.isArray(rules) ? rules : [];

  const transitions = ruleList.flatMap((rule) => {
    const entries = resolvePath(rule, ['Transitions']);
    return (Array.isArray(entries) ? entries : []).map((entry) => {
      const days = resolvePath(entry, ['TransitionInDays']);
      return {
        storageClass: resolveString(entry, ['StorageClass']),
        days: typeof days === 'number' ? days : Number.NaN,
      };
    });
  });

  const expirationDays = ruleList.flatMap((rule) => {
    const days = resolvePath(rule, ['ExpirationInDays']);
    return typeof days === 'number' ? [days] : [];
  });

  return { transitions, expirationDays };
}

function findLogicalIdByName(
  template: Template,
  resourceType: string,
  namePropertyKey: string,
  physicalName: string
): string {
  const resources = template.findResources(resourceType, {
    Properties: { [namePropertyKey]: physicalName },
  });
  return Object.keys(resources)[0] ?? '';
}

/** Whether an AWS::IAM::Policy resource is attached to the given role. */
function policyAttachedToRole(policy: unknown, roleLogicalId: string): boolean {
  const attachedRoles = resolvePath(policy, ['Properties', 'Roles']);
  return (Array.isArray(attachedRoles) ? attachedRoles : [])
    .some((roleRef) => resolveString(roleRef, ['Ref']) === roleLogicalId);
}

/** The Action entries of one Allow statement whose Resource targets the table. */
function statementActionsOnTable(statement: unknown, tableLogicalId: string): string[] {
  if (resolveString(statement, ['Effect']) !== 'Allow') return [];
  const resource = resolvePath(statement, ['Resource']);
  if (!collectGetAttTargets(resource).includes(tableLogicalId)) return [];

  const action = resolvePath(statement, ['Action']);
  return (Array.isArray(action) ? action : [action])
    .filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Every DynamoDB action a role's attached policies allow on one table,
 * deduplicated and sorted.
 *
 * Exists because IAM grants and runtime writes live in different languages and
 * different test suites: the Python tests hand `record_provider_failure` a
 * permissive mock table, so a missing `dynamodb:UpdateItem` in the template is
 * invisible everywhere except here. Both resources are located by physical
 * name so a logical-ID refactor cannot silently detach the assertion.
 */
function extractRoleTableActions(
  template: Template,
  roleName: string,
  tableName: string
): string[] {
  const roleLogicalId = findLogicalIdByName(template, 'AWS::IAM::Role', 'RoleName', roleName);
  const tableLogicalId =
    findLogicalIdByName(template, 'AWS::DynamoDB::Table', 'TableName', tableName);

  const actions = Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((policy) => policyAttachedToRole(policy, roleLogicalId))
    .flatMap((policy) => {
      const statements = resolvePath(policy, ['Properties', 'PolicyDocument', 'Statement']);
      return (Array.isArray(statements) ? statements : [])
        .flatMap((statement) => statementActionsOnTable(statement, tableLogicalId));
    });

  return [...new Set(actions)].sort((left, right) => left.localeCompare(right));
}

const synthesized: {
  definitionRaw: string;
  crawlerEnvVars: Record<string, unknown>;
  parseKeywordsEnvVars: Record<string, unknown>;
  keywordMgmtFunctionId: string;
  promoteMethods: ApiGatewayMethodSnapshot[];
  keywordIdMethods: ApiGatewayMethodSnapshot[];
  apiAuthSnapshots: ApiMethodAuthSnapshot[];
  userPoolClientProps: Record<string, unknown>;
  userPoolGroupNames: string[];
  contentStudioConcurrency: number | undefined;
  keywordMgmtConcurrency: number | undefined;
  outputKeys: string[];
  apiBackedFunctionTimeouts: Record<string, number>;
  apiLambdaLogGroups: LambdaLogGroupSnapshot[];
  workerLogGroupRetention: Map<string, number>;
  stateMachineLogging: StateMachineLoggingSnapshot;
  prodStageMethodSettings: StageMethodSettingSnapshot[];
  webAcls: WebAclSnapshot[];
  cloudFrontWafResourceIds: string[];
  screenshotsLifecycle: BucketLifecycleSnapshot;
  accessLogsLifecycle: BucketLifecycleSnapshot;
  searchRoleProviderConfigActions: string[];
} = {
  definitionRaw: '',
  crawlerEnvVars: {},
  parseKeywordsEnvVars: {},
  keywordMgmtFunctionId: '',
  promoteMethods: [],
  keywordIdMethods: [],
  apiAuthSnapshots: [],
  userPoolClientProps: {},
  userPoolGroupNames: [],
  contentStudioConcurrency: undefined,
  keywordMgmtConcurrency: undefined,
  outputKeys: [],
  apiBackedFunctionTimeouts: {},
  apiLambdaLogGroups: [],
  workerLogGroupRetention: new Map(),
  stateMachineLogging: { level: '', includesExecutionData: false, destinationRetentionDays: Number.NaN },
  prodStageMethodSettings: [],
  webAcls: [],
  cloudFrontWafResourceIds: [],
  screenshotsLifecycle: { transitions: [], expirationDays: [] },
  accessLogsLifecycle: { transitions: [], expirationDays: [] },
  searchRoleProviderConfigActions: [],
};

/**
 * The five Step Functions workers, which have carried explicit log groups since
 * they were written. Listed so the API-side fix cannot be delivered by
 * regressing the functions that were already correct.
 */
const WORKER_LOG_GROUP_NAMES = [
  '/aws/lambda/CitationAnalysis-ParseKeywords',
  '/aws/lambda/CitationAnalysis-Search',
  '/aws/lambda/CitationAnalysis-Deduplication',
  '/aws/lambda/CitationAnalysis-Crawler',
  '/aws/lambda/CitationAnalysis-GenerateSummary',
];

beforeAll(() => {
  const app = new cdk.App();
  const stack = new CitationAnalysisStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  synthesized.definitionRaw = extractStateMachineDefinition(template);
  synthesized.crawlerEnvVars = extractLambdaEnvVars(template, 'CitationAnalysis-Crawler');
  synthesized.parseKeywordsEnvVars = extractLambdaEnvVars(template, 'CitationAnalysis-ParseKeywords');
  synthesized.keywordMgmtFunctionId = findLambdaLogicalId(template, KEYWORD_MGMT_FUNCTION_NAME);

  const keywordsId = findApiResourceId(template, 'keywords');
  const promoteId = findApiResourceId(template, 'promote', keywordsId);
  const keywordId = findApiResourceId(template, '{id}', keywordsId);
  synthesized.promoteMethods = extractApiMethods(template, promoteId);
  synthesized.keywordIdMethods = extractApiMethods(template, keywordId);

  synthesized.apiAuthSnapshots = extractApiAuthSnapshots(template);
  synthesized.userPoolClientProps = extractUserPoolClientProps(template);
  synthesized.userPoolGroupNames = extractUserPoolGroupNames(template);

  synthesized.contentStudioConcurrency =
    extractReservedConcurrency(template, CONTENT_STUDIO_FUNCTION_NAME);
  synthesized.keywordMgmtConcurrency =
    extractReservedConcurrency(template, KEYWORD_MGMT_FUNCTION_NAME);
  synthesized.outputKeys = Object.keys(template.findOutputs('*'));
  synthesized.apiBackedFunctionTimeouts = extractApiBackedFunctionTimeouts(template);

  synthesized.apiLambdaLogGroups = extractLambdaLogGroups(template, API_FUNCTION_PREFIX);
  synthesized.workerLogGroupRetention = new Map(
    WORKER_LOG_GROUP_NAMES.map((name) => [name, retentionForLogGroupName(template, name)])
  );

  synthesized.stateMachineLogging = extractStateMachineLogging(template);
  synthesized.prodStageMethodSettings = extractProdStageMethodSettings(template);

  synthesized.webAcls = extractWebAcls(template);
  synthesized.cloudFrontWafResourceIds = Object.keys(
    template.findResources('AWS::CloudFormation::CustomResource')
  ).filter((logicalId) => logicalId.startsWith('CloudFrontWaf'));

  synthesized.screenshotsLifecycle = extractBucketLifecycle(template, SCREENSHOTS_BUCKET_PREFIX);
  synthesized.accessLogsLifecycle = extractBucketLifecycle(template, ACCESS_LOGS_BUCKET_PREFIX);

  synthesized.searchRoleProviderConfigActions =
    extractRoleTableActions(template, SEARCH_ROLE_NAME, PROVIDER_CONFIG_TABLE_NAME);
}, 60_000);

describe('API-facing Lambda timeouts respect the API Gateway ceiling', () => {
  /**
   * AUDIT-2026-08-19 §2.9. API Gateway's REST integration timeout is a hard
   * 29s. A longer Lambda timeout does not buy more time to answer — the client
   * already has its 504 — it buys more time to keep billing and writing for a
   * response nobody receives.
   */
  const GATEWAY_CEILING = 29;

  /**
   * The only functions allowed above the ceiling, with the exact timeout each
   * is allowed. Pinning the value (not just the name) means changing one forces
   * a look at the reasoning recorded at its definition.
   */
  const DOCUMENTED_EXCEPTIONS = new Map<string, number>([
    // Also runs as its own async worker; that path is not behind the gateway.
    ['CitationAnalysis-API-ContentStudio', 300],
    ['CitationAnalysis-API-KeywordMgmt', 120],
    // Persists its Bedrock result as the last step, so a 504 today is still
    // recoverable from the cache it writes. 29s would put the SIGKILL before
    // that write and make a slow keyword permanently broken.
    ['CitationAnalysis-API-SelfReflection', 60],
  ]);

  it('discovers the API-backed functions from the template', () => {
    /**
     * Non-vacuity guard: if the integration-URI walk broke, every assertion
     * below would pass against an empty map.
     */
    expect(Object.keys(synthesized.apiBackedFunctionTimeouts).length).toBeGreaterThan(8);
  });

  it('caps every API-backed function at or below 29s, except documented ones', () => {
    const offenders = Object.entries(synthesized.apiBackedFunctionTimeouts)
      .filter(([name, timeout]) => {
        const allowed = DOCUMENTED_EXCEPTIONS.get(name);
        return allowed === undefined
          ? timeout > GATEWAY_CEILING
          : timeout !== allowed;
      })
      .map(([name, timeout]) => `${name}=${timeout}s`);

    expect(offenders).toStrictEqual([]);
  });

  it('still has all three documented exceptions wired to the API', () => {
    /** Stops the allowlist rotting into a licence for arbitrary timeouts. */
    const apiBacked = Object.keys(synthesized.apiBackedFunctionTimeouts);

    expect(
      [...DOCUMENTED_EXCEPTIONS.keys()].every((name) => apiBacked.includes(name))
    ).toBe(true);
  });

  it('caps the seven previously-30s CRUD functions at the ceiling', () => {
    /**
     * 30 > 29 by one second: a request landing in that window 504'd while the
     * function completed and wrote. Named explicitly so the fix cannot be
     * quietly reverted one function at a time.
     */
    const capped = [
      'CitationAnalysis-API-CitationsContent',
      'CitationAnalysis-API-GetBrandMentions',
      'CitationAnalysis-API-ManageBrandConfig',
      'CitationAnalysis-API-ConfigMgmt',
      'CitationAnalysis-API-ExecutionMgmt',
      'CitationAnalysis-API-GetPersonaRankings',
      'CitationAnalysis-API-ManageUsers',
    ].map((name) => synthesized.apiBackedFunctionTimeouts[name]);

    expect(capped).toStrictEqual(Array(7).fill(GATEWAY_CEILING));
  });

  it('caps the stats and insights function, whose routes are read-only', () => {
    expect(
      synthesized.apiBackedFunctionTimeouts['CitationAnalysis-API-StatsInsights']
    ).toBe(GATEWAY_CEILING);
  });
});

describe('Self-invoking Lambda concurrency caps', () => {
  /**
   * AUDIT-2026-08-19 §2.4. Both functions re-invoke themselves asynchronously
   * for background work, and async invocations are retried twice by default.
   * Without a ceiling, a bug in a self-invoke guard consumes the account's
   * whole concurrency pool — starving every other function, manage-users
   * included — while billing an LLM call per invocation.
   */

  it('caps Content Studio, which self-invokes for content generation', () => {
    expect(synthesized.contentStudioConcurrency).toBe(SELF_INVOKING_CONCURRENCY);
  });

  it('caps Keyword Management, which self-invokes for keyword research', () => {
    expect(synthesized.keywordMgmtConcurrency).toBe(SELF_INVOKING_CONCURRENCY);
  });

  it('keeps the cap small enough to bound a runaway loop', () => {
    /**
     * The account default is ~1000. A cap only helps if it is far below that,
     * so this fails if someone "fixes" a throttling complaint by raising it to
     * something that no longer bounds anything.
     */
    const caps = [
      synthesized.contentStudioConcurrency,
      synthesized.keywordMgmtConcurrency,
    ];

    expect(caps.every((cap) => cap !== undefined && cap <= 50)).toBe(true);
  });
});

describe('Stack outputs do not claim protection that is not configured', () => {
  it('does not export the deleted API Gateway Web ACL', () => {
    /**
     * The ACL was created and never associated, so an output described as
     * "WAF Web ACL ARN protecting API Gateway" told anyone auditing the account
     * that protection existed where it did not (AUDIT-2026-08-19 §2.1). The
     * output went first; the ACL itself was deleted on 2026-08-19. This asserts
     * neither comes back.
     */
    expect(synthesized.outputKeys).not.toContain('WafWebAclArn');
  });

  it('still exports the CloudFront Web ACL, which is genuinely attached', () => {
    /** Guards against deleting the accurate output along with the false one. */
    expect(synthesized.outputKeys).toContain('CloudFrontWafWebAclArn');
  });
});

/**
 * AUDIT-2026-08-19 §2.1 — the WAF that protected nothing.
 *
 * `CitationAnalysis-API-WAF` was a REGIONAL Web ACL with four rules and, per
 * `list-resources-for-web-acl`, zero associated resources. It was deleted on
 * 2026-08-19 rather than attached: its rules target injection and volumetric
 * attacks on a public surface, and every route here except GET /api/health sits
 * behind the Cognito authorizer.
 *
 * The assertions below are framed as "no unassociated ACL survives" rather than
 * "no REGIONAL ACL survives", because a REGIONAL ACL legitimately remains — the
 * Auth construct binds one to the Cognito user pool. Scope is not what made the
 * deleted one waste; being unbound was.
 */
describe('WAF Web ACLs', () => {
  it('finds at least one Web ACL to reason about', () => {
    /**
     * Non-vacuity guard. Every assertion in this block is a claim about the set
     * of Web ACLs, and all of them hold trivially against an empty set.
     */
    expect(synthesized.webAcls.length).toBeGreaterThan(0);
  });

  it('no longer defines the API Gateway Web ACL', () => {
    const names = synthesized.webAcls.map((acl) => acl.name);

    expect(names).not.toContain(DELETED_API_WAF_NAME);
  });

  it('leaves behind no Web ACL that is billed without being bound to anything', () => {
    const unbound = synthesized.webAcls
      .filter((acl) => !acl.associated)
      .map((acl) => `${acl.logicalId} (${acl.scope})`);

    expect(unbound).toStrictEqual([]);
  });

  it('keeps the user pool Web ACL, which is REGIONAL and bound', () => {
    /**
     * Pins the reason the blanket "no REGIONAL ACL" phrasing was not used, so
     * nobody deletes this one while tidying up after the API ACL.
     */
    const bound = synthesized.webAcls.filter((acl) => acl.associated && acl.scope === 'REGIONAL');

    expect(bound).toHaveLength(1);
  });

  it('keeps the CloudFront Web ACL, which is created in us-east-1', () => {
    /**
     * It is not an AWS::WAFv2::WebACL in this template at all — CloudFront
     * requires a CLOUDFRONT-scoped ACL in us-east-1, so it is provisioned by a
     * custom resource. Asserted separately for that reason.
     */
    expect(synthesized.cloudFrontWafResourceIds).toStrictEqual(['CloudFrontWaf']);
  });
});

/**
 * AUDIT-2026-08-19 §0 invariants.
 *
 * The stack builds one `methodOptions` object and applies it verbatim to every
 * authenticated method, so these properties hold today but nothing stopped a
 * future route from being added without them. Before this block the spec
 * asserted exactly one security property, on one route.
 *
 * Deliberately NOT asserted here: `AuthorizationScopes`. The audit's fix step 2
 * proposes a Cognito resource-server scope on the admin routes, but API Gateway
 * validates scopes against the *access* token's `scope` claim, and custom
 * resource-server scopes are only minted by the OAuth2 hosted-UI flows. This
 * app signs in through the Amplify Authenticator (SRP), whose access token
 * carries only `aws.cognito.signin.user.admin` — so adding
 * `authorizationScopes` would 403 every admin route for every user, including
 * real administrators. The enforcement point is `shared.auth.require_group`,
 * which reads `cognito:groups` from the ID token the authorizer already
 * validates. Revisit only alongside a move to the hosted UI.
 */
describe('API authorization invariants', () => {
  it('exposes the health check as the only unauthenticated route', () => {
    const openRoutes = synthesized.apiAuthSnapshots
      .filter((method) => method.authorizationType !== COGNITO_AUTH)
      .map((method) => `${method.httpMethod} ${method.path}`);

    expect(openRoutes).toStrictEqual([`GET ${PUBLIC_ROUTE}`]);
  });

  it('requires the Cognito authorizer on every other route', () => {
    const unauthorized = synthesized.apiAuthSnapshots
      .filter((method) => method.path !== PUBLIC_ROUTE && method.authorizerId === '')
      .map((method) => `${method.httpMethod} ${method.path}`);

    expect(unauthorized).toStrictEqual([]);
  });

  it('points every authenticated route at the same single authorizer', () => {
    const authorizerIds = new Set(
      synthesized.apiAuthSnapshots
        .filter((method) => method.path !== PUBLIC_ROUTE)
        .map((method) => method.authorizerId)
    );

    expect(authorizerIds.size).toBe(1);
  });

  it('requires authorization on every state-changing method', () => {
    const openMutations = synthesized.apiAuthSnapshots
      .filter((method) => MUTATING_METHODS.includes(method.httpMethod))
      .filter((method) => method.authorizationType !== COGNITO_AUTH)
      .map((method) => `${method.httpMethod} ${method.path}`);

    expect(openMutations).toStrictEqual([]);
  });

  it('routes the administrative surfaces through the API at all', () => {
    /**
     * Guards the assertions above against passing vacuously: if the path
     * reconstruction broke, every list would be empty and every test green.
     */
    const adminPaths = synthesized.apiAuthSnapshots
      .map((method) => method.path)
      .filter((path) => path.startsWith('/api/users'));

    expect(adminPaths.length).toBeGreaterThan(0);
  });
});

describe('Cognito group definitions', () => {
  it('creates the Admin and Users groups', () => {
    /**
     * `shared.auth.ADMIN_GROUP` is the literal string 'Admin'. Renaming the
     * group here without changing the Python constant would silently disable
     * every authorization check, because an unmatched group name simply reads
     * as "caller is not an administrator".
     */
    expect(synthesized.userPoolGroupNames).toStrictEqual(['Admin', 'Users']);
  });
});

describe('Cognito token lifetimes', () => {
  it('limits access tokens to one hour', () => {
    /**
     * §0.4: the authorizer checks only signature and `exp`, so this value is
     * the window during which a disabled or deleted user keeps full privileges.
     * It was 8 hours.
     */
    expect(tokenValidityMinutes(synthesized.userPoolClientProps, 'Access'))
      .toBe(ONE_HOUR_IN_MINUTES);
  });

  it('limits ID tokens to one hour', () => {
    /** The ID token carries `cognito:groups`, which is what the gate reads. */
    expect(tokenValidityMinutes(synthesized.userPoolClientProps, 'Id'))
      .toBe(ONE_HOUR_IN_MINUTES);
  });

  it('allows refresh tokens to live for seven days', () => {
    /**
     * Longer than the access token on purpose: an 8h refresh token forced a
     * re-login every 8 hours while doing nothing for revocation latency.
     */
    expect(tokenValidityMinutes(synthesized.userPoolClientProps, 'Refresh'))
      .toBe(SEVEN_DAYS_IN_MINUTES);
  });

  it('keeps refresh tokens longer-lived than access tokens', () => {
    const access = tokenValidityMinutes(synthesized.userPoolClientProps, 'Access');
    const refresh = tokenValidityMinutes(synthesized.userPoolClientProps, 'Refresh');

    expect(refresh).toBeGreaterThan(access);
  });
});

describe('Step Functions workflow', () => {
  it('passes keyword to CrawlCitations Map itemSelector', () => {
    expect(synthesized.definitionRaw).toContain('"keyword.$":"$.keyword"');
  });

  it('selects query_prompts from the ParseKeywords output in ProcessKeywords Map', () => {
    expect(synthesized.definitionRaw).toContain('"query_prompts.$":"$.query_prompts"');
  });

  it('does not reference query_prompts from the raw execution input', () => {
    expect(synthesized.definitionRaw).not.toContain('$$.Execution.Input.query_prompts');
  });
});

describe('ParseKeywords Lambda environment', () => {
  it('includes the query prompts table for execution-time prompt resolution', () => {
    expect(synthesized.parseKeywordsEnvVars).toHaveProperty('DYNAMODB_TABLE_QUERY_PROMPTS');
    expect(synthesized.parseKeywordsEnvVars).toHaveProperty('QUERY_PROMPTS_TABLE');
  });
});

describe('Keyword promotion route', () => {
  it('exposes only POST on the promote resource through the KeywordMgmt function', () => {
    expect(synthesized.promoteMethods).toHaveLength(1);
    expect(synthesized.promoteMethods[0]?.httpMethod).toBe('POST');
    expect(synthesized.promoteMethods[0]?.integrationType).toBe('AWS_PROXY');
    expect(synthesized.promoteMethods[0]?.integrationUri).toContain(synthesized.keywordMgmtFunctionId);
  });

  it('requires the shared Cognito authorizer', () => {
    expect(synthesized.promoteMethods[0]?.authorizationType).toBe('COGNITO_USER_POOLS');
    expect(synthesized.promoteMethods[0]?.authorizerId).not.toBe('');
  });

  it('keeps PUT and DELETE on the sibling keyword id resource', () => {
    const idVerbs = synthesized.keywordIdMethods.map((method) => method.httpMethod);

    expect([...idVerbs].sort((left, right) => left.localeCompare(right))).toStrictEqual(['DELETE', 'PUT']);
    expect(idVerbs).not.toContain('POST');
  });
});

/**
 * AUDIT-2026-08-19 §2.7 — CloudWatch log retention.
 *
 * 39 of the account's 45 log groups were set to "Never expire", holding 70 MB
 * that only grew. None of them were in the template: the Lambda service creates
 * `/aws/lambda/<functionName>` on first invocation with no retention, so a
 * function without an explicit log group silently opts into keeping every log
 * line forever.
 *
 * The twelve API functions now declare their groups the way the five Step
 * Functions workers always did. The one asymmetry is deliberate and is what the
 * deletion-policy test below pins: those twelve groups already exist in the
 * deployed account, so they carry `Retain` to keep CloudFormation's import path
 * open, which requires a DeletionPolicy on every imported resource.
 */
describe('API Lambda log retention', () => {
  it('finds every API Lambda the audit listed', () => {
    /**
     * Non-vacuity guard, and a coverage floor. The audit named twelve
     * functions; the walk below reports offenders, so a function that lost its
     * FunctionName or its prefix would quietly drop out of the offender list
     * rather than fail. This is what notices.
     */
    expect(synthesized.apiLambdaLogGroups.length).toBeGreaterThanOrEqual(12);
  });

  it('bounds every API Lambda log group at 30 days', () => {
    const offenders = synthesized.apiLambdaLogGroups
      .filter((snapshot) => snapshot.retentionDays !== RETENTION_DAYS)
      .map((snapshot) => `${snapshot.functionName}=${snapshot.retentionDays}`);

    expect(offenders).toStrictEqual([]);
  });

  it('names each group after the function it belongs to', () => {
    /**
     * The name is what binds the construct to the group the Lambda service
     * already created. A typo here produces a second, empty group while the
     * original keeps growing untouched — retention would read as 30 and the
     * audit finding would be untouched.
     */
    const mismatched = synthesized.apiLambdaLogGroups
      .filter((snapshot) => snapshot.logGroupName !== `/aws/lambda/${snapshot.functionName}`)
      .map((snapshot) => `${snapshot.functionName} -> ${snapshot.logGroupName}`);

    expect(mismatched).toStrictEqual([]);
  });

  it('retains every API log group on stack removal', () => {
    /**
     * These groups predate the stack and hold production logs, so a renamed or
     * deleted construct must abandon the group rather than delete it. `Retain`
     * is also CloudFormation's precondition for importing them in the first
     * place.
     */
    const policies = new Set(
      synthesized.apiLambdaLogGroups.map((snapshot) => snapshot.deletionPolicy)
    );

    expect([...policies]).toStrictEqual([RETAIN]);
  });

  it('keeps the five Step Functions workers at 30 days', () => {
    /** The functions that were already correct stay correct. */
    const retentions = [...synthesized.workerLogGroupRetention.values()];

    expect(retentions).toStrictEqual(Array(WORKER_LOG_GROUP_NAMES.length).fill(RETENTION_DAYS));
  });
});

/**
 * AUDIT-2026-08-19 §2.8 — the workflow logged nothing.
 *
 * `loggingConfiguration.level` was OFF with `includeExecutionData: false`, so a
 * failed execution left no record of which Map iteration failed or on what
 * input. X-Ray showed that a state failed and how long it took, never the
 * payload that caused it — and with ProcessKeywords and CrawlCitations both
 * being Maps, that was the only question worth asking.
 */
describe('Step Functions execution logging', () => {
  it('logs every state transition, not only failures', () => {
    /**
     * ERROR would omit the per-iteration entry/exit either side of a Map
     * failure, which is where the evidence lives.
     */
    expect(synthesized.stateMachineLogging.level).toBe('ALL');
  });

  it('includes execution data so the failing input is recoverable', () => {
    /** Without this the logs name the state but never the payload. */
    expect(synthesized.stateMachineLogging.includesExecutionData).toBe(true);
  });

  it('expires the execution history after 30 days', () => {
    /**
     * Doubles as a non-vacuity guard: it only passes if the logging
     * destination resolves to a real log group in this template, rather than
     * the level and flag being set against nothing.
     *
     * Retention also bounds the exposure that `includeExecutionData` creates,
     * since keyword and citation payloads now land in CloudWatch.
     */
    expect(synthesized.stateMachineLogging.destinationRetentionDays).toBe(RETENTION_DAYS);
  });
});

/**
 * AUDIT-2026-08-19 §2.6 — no per-method API metrics.
 *
 * The prod stage had `metricsEnabled: false`, leaving only aggregate stage
 * metrics. "The API is throwing 5XXs" could not be narrowed to an endpoint, and
 * a per-endpoint alarm was not expressible because the metric did not exist.
 */
describe('API Gateway prod stage monitoring', () => {
  it('applies its method settings to every route', () => {
    /**
     * Non-vacuity guard: both assertions below read the first settings entry,
     * and both pass against an empty list. This also pins that the settings are
     * the stage-wide `*` / `/*` pair rather than a single lucky route.
     */
    const scopes = synthesized.prodStageMethodSettings
      .map((setting) => `${setting.httpMethod} ${setting.resourcePath}`);

    expect(scopes).toStrictEqual(['* /*']);
  });

  it('publishes per-method CloudWatch metrics', () => {
    const enabled = synthesized.prodStageMethodSettings.every((setting) => setting.metricsEnabled);

    expect(enabled).toBe(true);
  });

  it('keeps full request and response body logging off', () => {
    /**
     * `dataTraceEnabled` is not the companion to `metricsEnabled` that it looks
     * like. It writes whole request and response bodies to CloudWatch —
     * authenticated user payloads, brand configuration, entire LLM responses —
     * for detail the handlers' own structured logging already covers. Asserted
     * because enabling both together is the obvious mistake.
     */
    const tracing = synthesized.prodStageMethodSettings.some(
      (setting) => setting.dataTraceEnabled
    );

    expect(tracing).toBe(false);
  });
});

/**
 * AUDIT-2026-08-19 §2.5 — screenshots were being deleted, not archived.
 *
 * The bucket expired objects at 90 days. A screenshot is the only record of
 * what a cited page looked like when it was cited, and pages get rewritten, so
 * deletion is not recoverable by re-crawling — that captures today's page.
 */
describe('Screenshots bucket lifecycle', () => {
  it('moves screenshots to Infrequent Access at 90 days', () => {
    expect(synthesized.screenshotsLifecycle.transitions)
      .toStrictEqual([{ storageClass: IA_STORAGE_CLASS, days: IA_TRANSITION_DAYS }]);
  });

  it('never expires a screenshot', () => {
    /**
     * The transition assertion above would still pass with an expiration rule
     * sitting alongside it, so the absence is asserted on its own.
     */
    expect(synthesized.screenshotsLifecycle.expirationDays).toStrictEqual([]);
  });

  it('still expires S3 access logs at 90 days', () => {
    /**
     * The two buckets differ on purpose. Access logs are ephemeral audit
     * plumbing and were never the finding; only screenshots are irreplaceable.
     * Pinned so the "keep everything" reasoning is not generalised to a bucket
     * that should keep nothing.
     */
    expect(synthesized.accessLogsLifecycle.expirationDays)
      .toStrictEqual([ACCESS_LOGS_EXPIRY_DAYS]);
  });
});

/**
 * PR #103 review, blocker 1 — provider health writes were denied by IAM.
 *
 * The search Lambda records provider health after every provider result:
 * `record_provider_failure` / `record_provider_success`
 * (lambda/shared/provider_health.py) `update_item` the provider row, and the
 * auto-disable path flips `enabled = false` after repeated terminal failures.
 * The role's grant was read-only, so every write failed AccessDenied — and was
 * swallowed by design, because health bookkeeping must never break a search.
 * The 2026-08-14 incident fix therefore shipped dark: `consecutive_failures`
 * stayed 0, auto-disable never fired, and Settings kept its green ticks.
 *
 * Neither unit suite can see this seam — the Python tests mock the table, the
 * synth is the only artifact that carries the actual permission — so it is
 * pinned here.
 */
describe('Search Lambda provider-health permissions', () => {
  it('grants the search role at least one DynamoDB action on the ProviderConfig table', () => {
    /**
     * Non-vacuity guard: if either physical-name lookup broke, the walk would
     * return [] and a `toContain` below would fail confusingly; this names the
     * real problem first.
     */
    expect(synthesized.searchRoleProviderConfigActions.length).toBeGreaterThan(0);
  });

  it('lets the search role write provider health to the ProviderConfig table', () => {
    expect(synthesized.searchRoleProviderConfigActions).toContain('dynamodb:UpdateItem');
  });

  it('keeps the search role able to read provider enablement', () => {
    /** The read the run loop depends on must survive the write being added. */
    expect(synthesized.searchRoleProviderConfigActions).toContain('dynamodb:GetItem');
  });
});

describe('Crawler Lambda environment', () => {
  it('does not include unused BROWSER_TIMEOUT_MS env var', () => {
    expect(synthesized.crawlerEnvVars).not.toHaveProperty('BROWSER_TIMEOUT_MS');
  });

  it('does not include unused PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD env var', () => {
    expect(synthesized.crawlerEnvVars).not.toHaveProperty('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD');
  });

  it('does not include unused NOVA_ACT_SECRET_NAME env var', () => {
    expect(synthesized.crawlerEnvVars).not.toHaveProperty('NOVA_ACT_SECRET_NAME');
  });
});
