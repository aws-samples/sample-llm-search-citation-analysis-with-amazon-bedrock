import { Template } from 'aws-cdk-lib/assertions';

import * as fs from 'node:fs';
import * as path from 'node:path';

const PREFLIGHT_METHOD = 'OPTIONS';
export const COGNITO_AUTH = 'COGNITO_USER_POOLS';

/** Thrown when a lambda/shared module no longer exposes a constant a contract test reads. */
class MissingPythonConstantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingPythonConstantError';
  }
}

export interface ApiGatewayMethodSnapshot {
  httpMethod: string;
  integrationType: string;
  integrationUri: string;
  authorizationType: string;
  authorizerId: string;
}

export interface ApiMethodAuthSnapshot {
  path: string;
  httpMethod: string;
  authorizationType: string;
  authorizerId: string;
}

export interface LambdaLogGroupSnapshot {
  functionName: string;
  logGroupName: string;
  retentionDays: number;
  deletionPolicy: string;
}

export interface StateMachineLoggingSnapshot {
  level: string;
  includesExecutionData: boolean;
  destinationRetentionDays: number;
}

export interface StageMethodSettingSnapshot {
  resourcePath: string;
  httpMethod: string;
  metricsEnabled: boolean;
  dataTraceEnabled: boolean;
}

export interface WafFootprint {
  /** Logical ids of WAFv2 resources, and of the old CloudFront web ACL custom resource. */
  resourceIds: string[];
  /** `WebACLId` of every CloudFront distribution that sets one. */
  distributionWebAclIds: unknown[];
}

interface StorageClassTransition {
  storageClass: string;
  days: number;
}

export interface BucketLifecycleSnapshot {
  transitions: StorageClassTransition[];
  expirationDays: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Walk a nested unknown structure without unsafe member access. */
export function resolvePath(root: unknown, keys: string[]): unknown {
  return keys.reduce<unknown>(
    (current, key) => (isRecord(current) ? current[key] : undefined),
    root
  );
}

export function resolveString(root: unknown, keys: string[]): string {
  const value = resolvePath(root, keys);
  return typeof value === 'string' ? value : '';
}

function findStateMachine(template: Template, stateMachineName: string): unknown {
  const stateMachines = template.findResources('AWS::StepFunctions::StateMachine', {
    Properties: { StateMachineName: stateMachineName },
  });
  return stateMachines[Object.keys(stateMachines)[0] ?? ''];
}

export function findStateMachineLogicalId(template: Template, stateMachineName: string): string {
  const stateMachines = template.findResources('AWS::StepFunctions::StateMachine', {
    Properties: { StateMachineName: stateMachineName },
  });
  return Object.keys(stateMachines)[0] ?? '';
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

/** One property (path below `Properties`) of the Lambda function named `functionName`. */
function functionProperty(template: Template, functionName: string, propertyPath: string[]): unknown {
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  return resolvePath(functions[Object.keys(functions)[0] ?? ''], ['Properties', ...propertyPath]);
}

/** Logical id of the IAM role a Lambda function executes as. */
export function findFunctionRoleLogicalId(template: Template, functionName: string): string {
  return collectGetAttTargets(functionProperty(template, functionName, ['Role']))[0] ?? '';
}

/** Collect every logical ID referenced by a Ref anywhere in a node. */
export function collectRefTargets(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefTargets(item, found);
    return found;
  }
  if (isRecord(node)) {
    if (typeof node.Ref === 'string') found.push(node.Ref);
    for (const value of Object.values(node)) collectRefTargets(value, found);
  }
  return found;
}

/** The string parts of a state machine's `DefinitionString` join, tokens left as they are. */
function stateMachineDefinitionParts(template: Template, stateMachineName: string): unknown[] {
  const joinArgs = resolvePath(findStateMachine(template, stateMachineName), ['Properties', 'DefinitionString', 'Fn::Join']);
  return Array.isArray(joinArgs) && Array.isArray(joinArgs[1]) ? joinArgs[1] : [];
}

/** Extract a Step Functions definition JSON from the synthesized template. */
export function extractStateMachineDefinition(template: Template, stateMachineName: string): string {
  return stateMachineDefinitionParts(template, stateMachineName)
    .map((part) => (typeof part === 'string' ? part : '"__REF__"'))
    .join('');
}

export function extractLambdaEnvVars(template: Template, functionName: string): Record<string, unknown> {
  const envVars = functionProperty(template, functionName, ['Environment', 'Variables']);
  return isRecord(envVars) ? envVars : {};
}

/** The environment variables of every Lambda in the template, one map per function (`{}` when unset). */
function lambdaEnvironments(template: Template): Record<string, unknown>[] {
  return Object.values(template.findResources('AWS::Lambda::Function'))
    .map((resource) => resolvePath(resource, ['Properties', 'Environment', 'Variables']))
    .map((variables) => (isRecord(variables) ? variables : {}));
}

/** Env var names on any Lambda that name a table without the canonical `DYNAMODB_TABLE_` prefix (audit #12). */
export function nonCanonicalTableEnvNames(template: Template): string[] {
  return lambdaEnvironments(template)
    .flatMap((variables) => Object.keys(variables))
    .filter((name) => /_TABLE(_NAME)?$/.test(name) && !name.startsWith('DYNAMODB_TABLE_'));
}

/** The `BEDROCK_TIER_*` variables of every Lambda that sets any, one map per function. */
export function bedrockTierEnvironments(template: Template): Record<string, unknown>[] {
  return lambdaEnvironments(template)
    .map((variables) => Object.fromEntries(
      Object.entries(variables).filter(([name]) => name.startsWith('BEDROCK_TIER_'))
    ))
    .filter((tierVariables) => Object.keys(tierVariables).length > 0);
}

/** Map function names to timeouts for every Lambda reachable from API Gateway. */
export function extractApiBackedFunctionTimeouts(template: Template): Record<string, number> {
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

export function extractReservedConcurrency(
  template: Template,
  functionName: string
): number | undefined {
  const value = functionProperty(template, functionName, ['ReservedConcurrentExecutions']);
  return typeof value === 'number' ? value : undefined;
}

export function findLambdaLogicalId(template: Template, functionName: string): string {
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  return Object.keys(functions)[0] ?? '';
}

export function extractLambdaLayerRefs(template: Template, functionName: string): string[] {
  const layers = functionProperty(template, functionName, ['Layers']);
  if (!Array.isArray(layers)) return [];
  return layers
    .map((layer) => (isRecord(layer) && typeof layer.Ref === 'string' ? layer.Ref : ''))
    .filter((ref) => ref !== '');
}

export function extractTableProperty(
  template: Template,
  tableName: string,
  property: string
): unknown {
  const tables = template.findResources('AWS::DynamoDB::Table', {
    Properties: { TableName: tableName },
  });
  const [logicalId] = Object.keys(tables);
  if (!logicalId) return undefined;
  return resolvePath(tables[logicalId], ['Properties', property]);
}

export function extractTableKeySchema(template: Template, tableName: string): unknown {
  return extractTableProperty(template, tableName, 'KeySchema');
}

/** A numeric property of the named function; NaN when it is absent. */
function numericFunctionProperty(template: Template, functionName: string, property: string): number {
  const value = functionProperty(template, functionName, [property]);
  return typeof value === 'number' ? value : Number.NaN;
}

export function extractFunctionTimeout(template: Template, functionName: string): number {
  return numericFunctionProperty(template, functionName, 'Timeout');
}

export function extractFunctionMemorySize(template: Template, functionName: string): number {
  return numericFunctionProperty(template, functionName, 'MemorySize');
}

export function extractMemorySizesByLogicalIdPrefix(template: Template, prefix: string): number[] {
  return Object.entries(template.findResources('AWS::Lambda::Function'))
    .filter(([logicalId]) => logicalId.startsWith(prefix))
    .map(([, resource]) => resolvePath(resource, ['Properties', 'MemorySize']))
    .filter((memory): memory is number => typeof memory === 'number');
}

export function statementActions(statement: unknown): string[] {
  const action = resolvePath(statement, ['Action']);
  return (Array.isArray(action) ? action : [action])
    .filter((entry): entry is string => typeof entry === 'string');
}

function statementResources(statement: unknown): unknown[] {
  const resource = resolvePath(statement, ['Resource']);
  if (resource === undefined) return [];
  return Array.isArray(resource) ? resource : [resource];
}

function policyAttachedToRole(policy: unknown, roleLogicalId: string): boolean {
  const attachedRoles = resolvePath(policy, ['Properties', 'Roles']);
  return (Array.isArray(attachedRoles) ? attachedRoles : [])
    .some((roleRef) => resolveString(roleRef, ['Ref']) === roleLogicalId);
}

function allowStatementsOfPolicies(policies: unknown[]): unknown[] {
  return policies.flatMap((policy): unknown[] => {
    const statements = resolvePath(policy, ['Properties', 'PolicyDocument', 'Statement']);
    return (Array.isArray(statements) ? statements : [])
      .filter((statement) => resolveString(statement, ['Effect']) === 'Allow');
  });
}

export function allowStatementsOfRole(template: Template, roleLogicalId: string): unknown[] {
  return allowStatementsOfPolicies(
    Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((policy) => policyAttachedToRole(policy, roleLogicalId))
  );
}

/**
 * Every Allow statement in the template, whichever role holds it. Use when the
 * question is whether a permission exists anywhere at all.
 */
export function allowStatementsOfTemplate(template: Template): unknown[] {
  return allowStatementsOfPolicies(Object.values(template.findResources('AWS::IAM::Policy')));
}

function statementTargets(statement: unknown, resourceLogicalId: string): boolean {
  const resource = resolvePath(statement, ['Resource']);
  return [...collectGetAttTargets(resource), ...collectRefTargets(resource)].includes(resourceLogicalId);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function extractRoleActionsOn(
  template: Template,
  roleLogicalId: string,
  resourceLogicalId: string
): string[] {
  return sortedUnique(
    allowStatementsOfRole(template, roleLogicalId)
      .filter((statement) => statementTargets(statement, resourceLogicalId))
      .flatMap(statementActions)
  );
}

export function extractFunctionRoleActionsOn(
  template: Template,
  functionName: string,
  resourceLogicalId: string
): string[] {
  return extractRoleActionsOn(
    template,
    findFunctionRoleLogicalId(template, functionName),
    resourceLogicalId
  );
}

function statementTargetsExactGetAtt(
  statement: unknown,
  resourceLogicalId: string,
  attribute: string
): boolean {
  return statementResources(statement).some((resource) => {
    const getAtt = resolvePath(resource, ['Fn::GetAtt']);
    return Array.isArray(getAtt)
      && getAtt[0] === resourceLogicalId
      && getAtt[1] === attribute;
  });
}

function statementTargetsIndex(
  statement: unknown,
  tableLogicalId: string,
  indexName: string
): boolean {
  return statementResources(statement).some((resource) => (
    collectGetAttTargets(resource).includes(tableLogicalId)
      && JSON.stringify(resource).includes(`/index/${indexName}`)
  ));
}

function extractFunctionRoleActionsMatching(
  template: Template,
  functionName: string,
  predicate: (statement: unknown) => boolean
): string[] {
  const roleId = findFunctionRoleLogicalId(template, functionName);
  return sortedUnique(
    allowStatementsOfRole(template, roleId)
      .filter(predicate)
      .flatMap(statementActions)
  );
}

/** The role's allow statements that `matches`, as sorted-action snapshots. */
function roleStatementsMatching(
  template: Template,
  roleLogicalId: string,
  matches: (actions: string[]) => boolean
): IamPolicyStatementSnapshot[] {
  return allowStatementsOfRole(template, roleLogicalId)
    .filter((statement) => matches(statementActions(statement)))
    .map((statement) => ({
      actions: sortedUnique(statementActions(statement)),
      resources: statementResources(statement),
    }));
}

function roleStatementsForAction(
  template: Template,
  roleLogicalId: string,
  action: string
): IamPolicyStatementSnapshot[] {
  return roleStatementsMatching(template, roleLogicalId, (actions) => actions.includes(action));
}

function extractFunctionStatementsForAction(
  template: Template,
  functionName: string,
  action: string
): IamPolicyStatementSnapshot[] {
  return roleStatementsForAction(template, findFunctionRoleLogicalId(template, functionName), action);
}

export function extractFunctionRoleActions(template: Template, functionName: string): string[] {
  return sortedUnique(
    allowStatementsOfRole(template, findFunctionRoleLogicalId(template, functionName)).flatMap(statementActions)
  );
}

export function extractDefinitionTimeoutSeconds(definitionRaw: string): number {
  const match = /"TimeoutSeconds":(\d+)/.exec(definitionRaw);
  return match ? Number(match[1]) : Number.NaN;
}

export function findApiResourceId(template: Template, pathPart: string, parentId?: string): string {
  const resources = template.findResources('AWS::ApiGateway::Resource');
  return Object.entries(resources).find(([, resource]) => {
    const resourcePathPart = resolveString(resource, ['Properties', 'PathPart']);
    const resourceParentId = resolveString(resource, ['Properties', 'ParentId', 'Ref']);
    return resourcePathPart === pathPart && (parentId === undefined || resourceParentId === parentId);
  })?.[0] ?? '';
}

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

/** Every API Gateway method resource except the CORS preflight `OPTIONS` ones. */
function nonPreflightMethods(template: Template): unknown[] {
  return Object.values(template.findResources('AWS::ApiGateway::Method'))
    .filter((method) => resolveString(method, ['Properties', 'HttpMethod']) !== PREFLIGHT_METHOD);
}

export function extractApiAuthSnapshots(template: Template): ApiMethodAuthSnapshot[] {
  const paths = buildResourcePaths(template);
  return nonPreflightMethods(template).map((method) => methodAuthSnapshot(method, paths));
}

/** A method's route (`paths` maps resource logical ids to their paths) and authorization. */
function methodAuthSnapshot(method: unknown, paths: Map<string, string>): ApiMethodAuthSnapshot {
  return {
    path: paths.get(resolveString(method, ['Properties', 'ResourceId', 'Ref'])) ?? '/',
    httpMethod: resolveString(method, ['Properties', 'HttpMethod']),
    ...methodAuthorization(method),
  };
}

/** How an API Gateway method is authorized: its type and authorizer logical id. */
function methodAuthorization(method: unknown): { authorizationType: string; authorizerId: string } {
  return {
    authorizationType: resolveString(method, ['Properties', 'AuthorizationType']),
    authorizerId: resolveString(method, ['Properties', 'AuthorizerId', 'Ref']),
  };
}

export function tokenValidityMinutes(
  clientProps: Record<string, unknown>,
  token: 'Access' | 'Id' | 'Refresh'
): number {
  const raw = clientProps[`${token}TokenValidity`];
  if (typeof raw !== 'number') return Number.NaN;

  const unit = resolveString(clientProps, ['TokenValidityUnits', `${token}Token`]);
  const perUnit: Record<string, number> = {
    seconds: 1 / 60,
    minutes: 1,
    hours: 60,
    days: 1440,
  };

  return raw * (perUnit[unit] ?? Number.NaN);
}

export function extractUserPoolClientProps(template: Template): Record<string, unknown> {
  const clients = template.findResources('AWS::Cognito::UserPoolClient');
  const logicalId = Object.keys(clients)[0];
  const props = resolvePath(clients[logicalId], ['Properties']);
  return isRecord(props) ? props : {};
}

export function extractUserPoolGroupNames(template: Template): string[] {
  const groups = template.findResources('AWS::Cognito::UserPoolGroup');
  return Object.values(groups)
    .map((group) => resolveString(group, ['Properties', 'GroupName']))
    .sort((left, right) => left.localeCompare(right));
}

export function extractApiMethods(template: Template, resourceId: string): ApiGatewayMethodSnapshot[] {
  return nonPreflightMethods(template)
    .filter((method) => resolveString(method, ['Properties', 'ResourceId', 'Ref']) === resourceId)
    .map((method) => ({
      httpMethod: resolveString(method, ['Properties', 'HttpMethod']),
      integrationType: resolveString(method, ['Properties', 'Integration', 'Type']),
      integrationUri: methodIntegrationUri(method),
      ...methodAuthorization(method),
    }));
}

/** A method's integration URI as JSON, so token references can be matched as text. */
function methodIntegrationUri(method: unknown): string {
  return JSON.stringify(resolvePath(method, ['Properties', 'Integration', 'Uri'])) ?? '';
}

/**
 * The verbs among `methods` that are not behind the Cognito user pool
 * authorizer, and those whose integration is not the Lambda function with
 * logical id `functionLogicalId`. Both lists are empty for a fully guarded route set.
 */
export function unguardedVerbs(methods: ApiGatewayMethodSnapshot[], functionLogicalId: string) {
  return {
    withoutCognitoAuthorizer: methods
      .filter((method) => method.authorizationType !== COGNITO_AUTH)
      .map((method) => method.httpMethod),
    notIntegratedWithFunction: methods
      .filter((method) => !method.integrationUri.includes(functionLogicalId))
      .map((method) => method.httpMethod),
  };
}

/** The HTTP verbs of `methods`, alphabetically. */
export function sortedHttpMethods(methods: ApiGatewayMethodSnapshot[]): string[] {
  return methods.map((method) => method.httpMethod).sort((left, right) => left.localeCompare(right));
}

/** `unguardedVerbs` of a route set where every verb is behind Cognito and the expected function. */
export const FULLY_GUARDED = { withoutCognitoAuthorizer: [], notIntegratedWithFunction: [] };

/** `"<VERB> <path>"` for each method, the form route assertions report. */
export function methodRouteLabels(methods: ApiMethodAuthSnapshot[]): string[] {
  return methods.map((method) => `${method.httpMethod} ${method.path}`);
}

/** The `Fn::Join` CDK synthesizes for `arn:<partition>:<service>:<region>:<account>:<resource>`. */
export function regionalArnJoin(service: string, resource: string): unknown {
  return {
    'Fn::Join': ['', [
      'arn:',
      { Ref: 'AWS::Partition' },
      `:${service}:`,
      { Ref: 'AWS::Region' },
      ':',
      { Ref: 'AWS::AccountId' },
      `:${resource}`,
    ]],
  };
}

function retentionDaysOf(logGroups: Record<string, unknown>, logicalId: string): number {
  const days = resolvePath(logGroups[logicalId], ['Properties', 'RetentionInDays']);
  return typeof days === 'number' ? days : Number.NaN;
}

export function extractLambdaLogGroups(template: Template, prefix: string): LambdaLogGroupSnapshot[] {
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

export function retentionForLogGroupName(template: Template, logGroupName: string): number {
  const groups = template.findResources('AWS::Logs::LogGroup', {
    Properties: { LogGroupName: logGroupName },
  });
  return retentionDaysOf(groups, Object.keys(groups)[0] ?? '');
}

export function extractStateMachineLogging(
  template: Template,
  stateMachineName: string
): StateMachineLoggingSnapshot {
  const config = resolvePath(
    findStateMachine(template, stateMachineName),
    ['Properties', 'LoggingConfiguration']
  );
  const destinations = resolvePath(config, ['Destinations']);
  const destination: unknown = Array.isArray(destinations) ? destinations[0] : undefined;
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

export function extractProdStageMethodSettings(template: Template): StageMethodSettingSnapshot[] {
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

export function extractWafFootprint(template: Template): WafFootprint {
  const resources: [string, unknown][] = Object.entries(resolvePath(template.toJSON(), ['Resources']) ?? {});
  const resourceIds = resources
    .filter(([logicalId, resource]) =>
      String(resolvePath(resource, ['Type'])).startsWith('AWS::WAFv2::') || logicalId.startsWith('CloudFrontWaf'))
    .map(([logicalId]) => logicalId);
  const distributionWebAclIds = Object.values(template.findResources('AWS::CloudFront::Distribution'))
    .map((distribution) => resolvePath(distribution, ['Properties', 'DistributionConfig', 'WebACLId']))
    .filter((webAclId) => webAclId !== undefined);

  return {
    resourceIds,
    distributionWebAclIds,
  };
}

function bucketLifecycleRules(template: Template, namePrefix: string): unknown[] {
  const [bucket] = Object.values(template.findResources('AWS::S3::Bucket'))
    .filter((candidate) =>
      JSON.stringify(resolvePath(candidate, ['Properties', 'BucketName'])).includes(namePrefix));
  const rules = resolvePath(bucket, ['Properties', 'LifecycleConfiguration', 'Rules']);
  return Array.isArray(rules) ? rules : [];
}

export function extractBucketLifecycle(template: Template, namePrefix: string): BucketLifecycleSnapshot {
  const ruleList = bucketLifecycleRules(template, namePrefix);

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

export function findLogicalIdByName(
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

export function extractRoleTableActions(
  template: Template,
  roleName: string,
  tableName: string
): string[] {
  const roleLogicalId = findLogicalIdByName(template, 'AWS::IAM::Role', 'RoleName', roleName);
  const tableLogicalId = findLogicalIdByName(
    template,
    'AWS::DynamoDB::Table',
    'TableName',
    tableName
  );

  return extractRoleActionsOn(template, roleLogicalId, tableLogicalId);
}

interface IamPolicyStatementSnapshot {
  actions: string[];
  resources: unknown[];
}

export interface CrawlerInfrastructureSnapshot {
  crawledContentTableIndexes: unknown;
  crawlerEnvVars: Record<string, unknown>;
  crawlerRoleCrawledContentActions: string[];
  crawlerBrowserLogicalId: string;
  crawlerRoleBrowserStatements: IamPolicyStatementSnapshot[];
  browserSigningRoleActions: string[];
  browserSigningTrustConditions: unknown;
}

function isCrawlerBrowserAction(action: string): boolean {
  return action.startsWith('bedrock-agentcore:')
    || action === 'bedrock:GetAgent'
    || action === 'bedrock:InvokeAgent';
}

/** Crawler-specific synthesized values shared by the cache and browser-security suites. */
export function extractCrawlerInfrastructureSnapshot(
  template: Template
): CrawlerInfrastructureSnapshot {
  const crawlerFunctionName = 'CitationAnalysis-Crawler';
  const crawlerRoleName = 'CitationAnalysis-CrawlerLambdaRole';
  const crawledContentTableName = 'CitationAnalysis-CrawledContent';
  const browserSigningRoleName = 'CitationAnalysis-BrowserSigningRole';
  const crawlerRoleId = findLogicalIdByName(
    template,
    'AWS::IAM::Role',
    'RoleName',
    crawlerRoleName
  );
  const crawlerBrowserLogicalId = findLogicalIdByName(
    template,
    'AWS::BedrockAgentCore::BrowserCustom',
    'Name',
    'citation_analysis_crawler'
  );
  const browserSigningRoleId = findLogicalIdByName(
    template,
    'AWS::IAM::Role',
    'RoleName',
    browserSigningRoleName
  );
  const browserSigningRoles = template.findResources('AWS::IAM::Role', {
    Properties: { RoleName: browserSigningRoleName },
  });
  const crawlerRoleBrowserStatements = roleStatementsMatching(
    template,
    crawlerRoleId,
    (actions) => actions.some(isCrawlerBrowserAction)
  );

  return {
    crawledContentTableIndexes: extractTableProperty(
      template,
      crawledContentTableName,
      'GlobalSecondaryIndexes'
    ),
    crawlerEnvVars: extractLambdaEnvVars(template, crawlerFunctionName),
    crawlerRoleCrawledContentActions: extractRoleTableActions(
      template,
      crawlerRoleName,
      crawledContentTableName
    ),
    crawlerBrowserLogicalId,
    crawlerRoleBrowserStatements,
    browserSigningRoleActions: sortedUnique(
      allowStatementsOfRole(template, browserSigningRoleId).flatMap(statementActions)
    ),
    browserSigningTrustConditions: resolvePath(
      browserSigningRoles[browserSigningRoleId],
      ['Properties', 'AssumeRolePolicyDocument', 'Statement', '0', 'Condition']
    ),
  };
}


/** A GSI as synthesized: hash and range key with the default ALL projection. */
export function allProjectionIndexSchema(indexName: string, hashKey: string, rangeKey: string) {
  return {
    IndexName: indexName,
    KeySchema: [
      { AttributeName: hashKey, KeyType: 'HASH' },
      { AttributeName: rangeKey, KeyType: 'RANGE' },
    ],
    Projection: { ProjectionType: 'ALL' },
  };
}

export const STATUS_CREATED_INDEX_SCHEMA = allProjectionIndexSchema('StatusCreatedIndex', 'status', 'created_at');

interface ContentStudioRouteSnapshot extends ApiMethodAuthSnapshot {
  integrationUri: string;
}

interface ContentStudioEventSourceSnapshot {
  batchSize: number | undefined;
  startingPosition: string;
  retryAttempts: number | undefined;
  maxRecordAgeSeconds: number | undefined;
  filterPatterns: string[];
  tableLogicalIds: string[];
  functionLogicalIds: string[];
  onFailureQueueLogicalIds: string[];
}

interface ContentStudioStreamDlqSnapshot {
  logicalId: string;
  queueName: string;
  retentionSeconds: number | undefined;
  sqsManagedSseEnabled: boolean | undefined;
  sslEnforced: boolean;
  workerActions: string[];
  alarmCount: number;
}

interface ContentStudioReconcileRuleSnapshot {
  scheduleExpression: string;
  state: string;
  targetInput: string;
  functionLogicalIds: string[];
}

export interface ContentStudioInfrastructureSnapshot {
  contentTableLogicalId: string;
  contentTableIndexes: unknown;
  contentTableStream: unknown;
  batchTableLogicalId: string;
  batchTableKeySchema: unknown;
  batchTableIndexes: unknown;
  batchTableBillingMode: unknown;
  batchTablePointInTimeRecovery: unknown;
  batchTableDeletionPolicy: string;
  batchTableActions: string[];
  templateTableKeySchema: unknown;
  templateTableIndexes: unknown;
  templateTableBillingMode: unknown;
  templateTablePointInTimeRecovery: unknown;
  templateTableDeletionPolicy: string;
  environment: Record<string, unknown>;
  workerEnvironment: Record<string, unknown>;
  templateTableActions: string[];
  routes: ContentStudioRouteSnapshot[];
  functionLogicalId: string;
  workerFunctionLogicalId: string;
  apiTimeout: number;
  workerTimeout: number;
  apiHandler: string;
  workerHandler: string;
  apiLayerRefs: string[];
  workerLayerRefs: string[];
  apiRoleActions: string[];
  workerRoleActions: string[];
  apiContentTableActions: string[];
  apiContentStatusIndexActions: string[];
  workerContentTableActions: string[];
  workerContentBaseActions: string[];
  workerContentStatusIndexActions: string[];
  workerContentStreamActions: string[];
  apiCrawledContentTableActions: string[];
  workerBrandConfigTableActions: string[];
  workerCrawledContentTableActions: string[];
  workerTemplateTableActions: string[];
  workerBatchTableActions: string[];
  apiInvokeStatements: IamPolicyStatementSnapshot[];
  workerInvokeStatements: IamPolicyStatementSnapshot[];
  streamDlq: ContentStudioStreamDlqSnapshot;
  reconcileRule: ContentStudioReconcileRuleSnapshot;
  reservedConcurrency: number | undefined;
  workerReservedConcurrency: number | undefined;
  eventSource: ContentStudioEventSourceSnapshot;
}

/** Content Studio storage, permissions, routes, and worker wiring as synthesized. */
export function extractContentStudioInfrastructureSnapshot(
  template: Template
): ContentStudioInfrastructureSnapshot {
  const functionName = 'CitationAnalysis-API-ContentStudio';
  const workerFunctionName = 'CitationAnalysis-ContentStudioWorker';
  const contentTableName = 'CitationAnalysis-ContentStudio';
  const contentTableLogicalId = findLogicalIdByName(
    template,
    'AWS::DynamoDB::Table',
    'TableName',
    contentTableName
  );
  const brandConfigTableLogicalId = findLogicalIdByName(
    template,
    'AWS::DynamoDB::Table',
    'TableName',
    'CitationAnalysis-BrandConfig'
  );
  const crawledContentTableLogicalId = findLogicalIdByName(
    template,
    'AWS::DynamoDB::Table',
    'TableName',
    'CitationAnalysis-CrawledContent'
  );
  const streamDlqName = 'CitationAnalysis-ContentStudioStreamDLQ';
  const streamDlqLogicalId = findLogicalIdByName(
    template,
    'AWS::SQS::Queue',
    'QueueName',
    streamDlqName
  );
  const streamDlqResources = template.findResources('AWS::SQS::Queue', {
    Properties: { QueueName: streamDlqName },
  });
  const streamDlqResource = streamDlqResources[streamDlqLogicalId];
  const reconcileRuleName = 'CitationAnalysis-ContentStudioReconcile';
  const reconcileRuleLogicalId = findLogicalIdByName(
    template,
    'AWS::Events::Rule',
    'Name',
    reconcileRuleName
  );
  const reconcileRules = template.findResources('AWS::Events::Rule', {
    Properties: { Name: reconcileRuleName },
  });
  const reconcileRuleResource = reconcileRules[reconcileRuleLogicalId];
  const reconcileTargets = resolvePath(reconcileRuleResource, ['Properties', 'Targets']);
  const firstReconcileTarget = resolvePath(reconcileTargets, ['0']);
  const batchTableName = 'CitationAnalysis-ContentBriefBatches';
  const batchTableId = findLogicalIdByName(
    template,
    'AWS::DynamoDB::Table',
    'TableName',
    batchTableName
  );
  const batchTables = template.findResources('AWS::DynamoDB::Table', {
    Properties: { TableName: batchTableName },
  });
  const batchTable = batchTables[batchTableId];
  const templateTableName = 'CitationAnalysis-ContentBriefTemplates';
  const templateTableId = findLogicalIdByName(
    template,
    'AWS::DynamoDB::Table',
    'TableName',
    templateTableName
  );
  const templateTables = template.findResources('AWS::DynamoDB::Table', {
    Properties: { TableName: templateTableName },
  });
  const templateTable = templateTables[templateTableId];
  const apiFunctions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  const workerFunctions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: workerFunctionName },
  });
  const functionLogicalId = Object.keys(apiFunctions)[0] ?? '';
  const workerFunctionLogicalId = Object.keys(workerFunctions)[0] ?? '';
  const apiFunction = apiFunctions[functionLogicalId];
  const workerFunction = workerFunctions[workerFunctionLogicalId];
  const mappings = Object.values(template.findResources('AWS::Lambda::EventSourceMapping'));
  const eventSourceMapping = mappings.find((mapping) =>
    collectGetAttTargets(resolvePath(mapping, ['Properties', 'EventSourceArn']))
      .includes(contentTableLogicalId)
  );
  const filters = resolvePath(eventSourceMapping, ['Properties', 'FilterCriteria', 'Filters']);
  const eventSourceBatchSize = resolvePath(eventSourceMapping, ['Properties', 'BatchSize']);
  const eventSourceRetryAttempts = resolvePath(
    eventSourceMapping,
    ['Properties', 'MaximumRetryAttempts']
  );
  const eventSourceMaxRecordAge = resolvePath(
    eventSourceMapping,
    ['Properties', 'MaximumRecordAgeInSeconds']
  );
  const onFailureDestination = resolvePath(
    eventSourceMapping,
    ['Properties', 'DestinationConfig', 'OnFailure', 'Destination']
  );
  const resourcePaths = buildResourcePaths(template);
  const routes = nonPreflightMethods(template)
    .map((method): ContentStudioRouteSnapshot => ({
      ...methodAuthSnapshot(method, resourcePaths),
      integrationUri: methodIntegrationUri(method),
    }))
    .filter((route) => route.path.startsWith('/api/content-studio'));
  const streamDlqRetention = resolvePath(
    streamDlqResource,
    ['Properties', 'MessageRetentionPeriod']
  );
  const streamDlqSse = resolvePath(
    streamDlqResource,
    ['Properties', 'SqsManagedSseEnabled']
  );
  const streamDlqSslEnforced = Object.values(
    template.findResources('AWS::SQS::QueuePolicy')
  ).some((policy) => (
    JSON.stringify(policy).includes('aws:SecureTransport')
      && JSON.stringify(policy).includes('false')
      && [
        ...collectGetAttTargets(policy),
        ...collectRefTargets(policy),
      ].includes(streamDlqLogicalId)
  ));
  const streamDlqAlarmCount = Object.values(
    template.findResources('AWS::CloudWatch::Alarm')
  ).filter((alarm) => [
    ...collectGetAttTargets(alarm),
    ...collectRefTargets(alarm),
  ].includes(streamDlqLogicalId)).length;

  return {
    contentTableLogicalId,
    contentTableIndexes: extractTableProperty(
      template,
      contentTableName,
      'GlobalSecondaryIndexes'
    ),
    contentTableStream: extractTableProperty(
      template,
      contentTableName,
      'StreamSpecification'
    ),
    batchTableLogicalId: batchTableId,
    batchTableKeySchema: extractTableKeySchema(template, batchTableName),
    batchTableIndexes: extractTableProperty(
      template,
      batchTableName,
      'GlobalSecondaryIndexes'
    ),
    batchTableBillingMode: resolvePath(batchTable, ['Properties', 'BillingMode']),
    batchTablePointInTimeRecovery: resolvePath(
      batchTable,
      ['Properties', 'PointInTimeRecoverySpecification', 'PointInTimeRecoveryEnabled']
    ),
    batchTableDeletionPolicy: resolveString(batchTable, ['DeletionPolicy']),
    batchTableActions: extractFunctionRoleActionsOn(
      template,
      functionName,
      batchTableId
    ),
    templateTableKeySchema: extractTableKeySchema(template, templateTableName),
    templateTableIndexes: extractTableProperty(
      template,
      templateTableName,
      'GlobalSecondaryIndexes'
    ),
    templateTableBillingMode: resolvePath(templateTable, ['Properties', 'BillingMode']),
    templateTablePointInTimeRecovery: resolvePath(
      templateTable,
      ['Properties', 'PointInTimeRecoverySpecification', 'PointInTimeRecoveryEnabled']
    ),
    templateTableDeletionPolicy: resolveString(templateTable, ['DeletionPolicy']),
    environment: extractLambdaEnvVars(template, functionName),
    workerEnvironment: extractLambdaEnvVars(template, workerFunctionName),
    templateTableActions: extractFunctionRoleActionsOn(
      template,
      functionName,
      templateTableId
    ),
    routes,
    functionLogicalId,
    workerFunctionLogicalId,
    apiTimeout: extractFunctionTimeout(template, functionName),
    workerTimeout: extractFunctionTimeout(template, workerFunctionName),
    apiHandler: resolveString(apiFunction, ['Properties', 'Handler']),
    workerHandler: resolveString(workerFunction, ['Properties', 'Handler']),
    apiLayerRefs: extractLambdaLayerRefs(template, functionName),
    workerLayerRefs: extractLambdaLayerRefs(template, workerFunctionName),
    apiRoleActions: extractFunctionRoleActions(template, functionName),
    workerRoleActions: extractFunctionRoleActions(template, workerFunctionName),
    apiContentTableActions: extractFunctionRoleActionsMatching(
      template,
      functionName,
      (statement) => statementTargetsExactGetAtt(statement, contentTableLogicalId, 'Arn')
    ),
    apiContentStatusIndexActions: extractFunctionRoleActionsMatching(
      template,
      functionName,
      (statement) => statementTargetsIndex(statement, contentTableLogicalId, 'StatusCreatedIndex')
    ),
    workerContentTableActions: extractFunctionRoleActionsOn(
      template,
      workerFunctionName,
      contentTableLogicalId
    ),
    workerContentBaseActions: extractFunctionRoleActionsMatching(
      template,
      workerFunctionName,
      (statement) => statementTargetsExactGetAtt(statement, contentTableLogicalId, 'Arn')
    ),
    workerContentStatusIndexActions: extractFunctionRoleActionsMatching(
      template,
      workerFunctionName,
      (statement) => statementTargetsIndex(statement, contentTableLogicalId, 'StatusCreatedIndex')
    ),
    workerContentStreamActions: extractFunctionRoleActionsMatching(
      template,
      workerFunctionName,
      (statement) => statementTargetsExactGetAtt(statement, contentTableLogicalId, 'StreamArn')
    ),
    apiCrawledContentTableActions: extractFunctionRoleActionsOn(
      template,
      functionName,
      crawledContentTableLogicalId
    ),
    workerBrandConfigTableActions: extractFunctionRoleActionsOn(
      template,
      workerFunctionName,
      brandConfigTableLogicalId
    ),
    workerCrawledContentTableActions: extractFunctionRoleActionsOn(
      template,
      workerFunctionName,
      crawledContentTableLogicalId
    ),
    workerTemplateTableActions: extractFunctionRoleActionsOn(
      template,
      workerFunctionName,
      templateTableId
    ),
    workerBatchTableActions: extractFunctionRoleActionsOn(
      template,
      workerFunctionName,
      batchTableId
    ),
    apiInvokeStatements: extractFunctionStatementsForAction(
      template,
      functionName,
      'lambda:InvokeFunction'
    ),
    workerInvokeStatements: extractFunctionStatementsForAction(
      template,
      workerFunctionName,
      'lambda:InvokeFunction'
    ),
    streamDlq: {
      logicalId: streamDlqLogicalId,
      queueName: resolveString(streamDlqResource, ['Properties', 'QueueName']),
      retentionSeconds: typeof streamDlqRetention === 'number'
        ? streamDlqRetention
        : undefined,
      sqsManagedSseEnabled: typeof streamDlqSse === 'boolean'
        ? streamDlqSse
        : undefined,
      sslEnforced: streamDlqSslEnforced,
      workerActions: extractFunctionRoleActionsOn(
        template,
        workerFunctionName,
        streamDlqLogicalId
      ),
      alarmCount: streamDlqAlarmCount,
    },
    reconcileRule: {
      scheduleExpression: resolveString(
        reconcileRuleResource,
        ['Properties', 'ScheduleExpression']
      ),
      state: resolveString(reconcileRuleResource, ['Properties', 'State']),
      targetInput: resolveString(firstReconcileTarget, ['Input']),
      functionLogicalIds: [
        ...collectGetAttTargets(resolvePath(firstReconcileTarget, ['Arn'])),
        ...collectRefTargets(resolvePath(firstReconcileTarget, ['Arn'])),
      ],
    },
    reservedConcurrency: extractReservedConcurrency(template, functionName),
    workerReservedConcurrency: extractReservedConcurrency(template, workerFunctionName),
    eventSource: {
      batchSize: typeof eventSourceBatchSize === 'number'
        ? eventSourceBatchSize
        : undefined,
      startingPosition: resolveString(eventSourceMapping, ['Properties', 'StartingPosition']),
      retryAttempts: typeof eventSourceRetryAttempts === 'number'
        ? eventSourceRetryAttempts
        : undefined,
      maxRecordAgeSeconds: typeof eventSourceMaxRecordAge === 'number'
        ? eventSourceMaxRecordAge
        : undefined,
      filterPatterns: Array.isArray(filters)
        ? filters.map((filter) => resolveString(filter, ['Pattern']))
        : [],
      tableLogicalIds: collectGetAttTargets(
        resolvePath(eventSourceMapping, ['Properties', 'EventSourceArn'])
      ),
      functionLogicalIds: [
        ...collectGetAttTargets(resolvePath(eventSourceMapping, ['Properties', 'FunctionName'])),
        ...collectRefTargets(resolvePath(eventSourceMapping, ['Properties', 'FunctionName'])),
      ],
      onFailureQueueLogicalIds: [
        ...collectGetAttTargets(onFailureDestination),
        ...collectRefTargets(onFailureDestination),
      ],
    },
  };
}


/**
 * The model IDs `lambda/shared/models.py` resolves for its tiers, as plain
 * foundation model IDs (the `global.` inference-profile prefix stripped).
 *
 * Read from the Python source rather than duplicated here: the stack subscribes
 * these models to AWS Marketplace at deploy time, and a tier upgrade that only
 * touched Python would otherwise ship a model the account has no agreement for,
 * which fails at runtime with AccessDenied rather than at synth.
 */
export function pythonTierFoundationModelIds(): string[] {
  const block = capturedPythonSource('models.py', /_TIER_MODELS: dict\[ModelTier, str\] = \{([\s\S]*?)\}/, '_TIER_MODELS');
  return [...block.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1].replace(/^global\./, ''))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * `BEDROCK_TIER_<ROLE>` → tier for every role in `_ROLE_DEFAULT_TIER` of
 * `lambda/shared/models.py`: the defaults the stack's `bedrockTierEnv` restates.
 */
export function pythonRoleDefaultTierEnv(): Record<string, string> {
  const roles = pythonStrEnumValues('ModelRole');
  const tiers = pythonStrEnumValues('ModelTier');
  const block = capturedPythonSource(
    'models.py',
    /_ROLE_DEFAULT_TIER: dict\[ModelRole, ModelTier\] = \{([\s\S]*?)\}/,
    '_ROLE_DEFAULT_TIER'
  );
  return Object.fromEntries(
    [...block.matchAll(/ModelRole\.(\w+): ModelTier\.(\w+)/g)].map(([, role, tier]) => [
      `BEDROCK_TIER_${enumValue(roles, role).toUpperCase()}`,
      enumValue(tiers, tier),
    ])
  );
}

/** `RESEARCH_STALE_AFTER_SECONDS` of `lambda/shared/research_jobs.py`, evaluated (`35 * 60` → 2100). */
export function pythonResearchStaleAfterSeconds(): number {
  const expression = capturedPythonSource(
    'research_jobs.py',
    /^RESEARCH_STALE_AFTER_SECONDS = ([\d *]+)$/m,
    'RESEARCH_STALE_AFTER_SECONDS'
  );
  return expression.split('*').reduce((product, factor) => product * Number(factor), 1);
}

function pythonStrEnumValues(className: string): Map<string, string> {
  const body = capturedPythonSource('models.py', new RegExp(`class ${className}\\(StrEnum\\):([\\s\\S]*?)\\n\\n\\n`), className);
  return new Map([...body.matchAll(/^ +(\w+) = "([^"]+)"/gm)].map(([, member, value]) => [member, value]));
}

function enumValue(members: Map<string, string>, member: string): string {
  const value = members.get(member);
  if (value === undefined) {
    throw new MissingPythonConstantError(`Unknown enum member ${member} in lambda/shared/models.py`);
  }
  return value;
}

/** First capture group of `pattern` in `lambda/shared/<fileName>`; throws when the constant is gone. */
function capturedPythonSource(fileName: string, pattern: RegExp, constantName: string): string {
  const source = fs.readFileSync(path.join(__dirname, '../lambda/shared', fileName), 'utf8');
  const match = pattern.exec(source);
  if (!match) {
    throw new MissingPythonConstantError(`Could not find ${constantName} in lambda/shared/${fileName}`);
  }
  return match[1];
}


interface UseCaseSubmission {
  parameters?: { formData?: string };
  region?: string;
  ignoreErrorCodesMatching?: string;
}

/**
 * The `Create` payload of the Anthropic use-case submission, parsed. Returns
 * undefined when the stack synthesized no submission at all, which is what
 * `-c skipModelProvisioning=true` is expected to produce.
 */
export function findUseCaseSubmission(template: Template): UseCaseSubmission | undefined {
  const create = Object.values(template.findResources('Custom::AWS'))
    .map((resource) => resolvePath(resource, ['Properties', 'Create']))
    .find((payload): payload is string => typeof payload === 'string'
      && payload.includes('putUseCaseForModelAccess'));

  return create === undefined ? undefined : JSON.parse(create) as UseCaseSubmission;
}

/**
 * The members of `errorNames` the use-case submission's
 * `ignoreErrorCodesMatching` pattern tolerates, in order; undefined when no
 * submission or no pattern was synthesized.
 */
export function useCaseToleratedErrorNames(template: Template, errorNames: string[]): string[] | undefined {
  const pattern = findUseCaseSubmission(template)?.ignoreErrorCodesMatching;
  if (pattern === undefined) return undefined;
  const tolerated = new RegExp(pattern);
  return errorNames.filter((errorName) => tolerated.test(errorName));
}

/**
 * The per-model Marketplace agreement custom resources, keyed by logical id.
 * Identified by carrying a `modelId` property, which separates them from the
 * other CloudFormation custom resources in the template.
 */
export function findModelAgreements(template: Template): [string, unknown][] {
  return Object.entries(template.findResources('AWS::CloudFormation::CustomResource'))
    .filter(([, resource]) => typeof resolvePath(resource, ['Properties', 'modelId']) === 'string');
}



/** What the keyword-scale workflow (Distributed Map, S3 hand-offs) synthesizes to. */
export interface WorkflowScaleSnapshot {
  /** The analysis workflow definition, CloudFormation tokens replaced by `__TOKEN__`. */
  definition: unknown;
  keywordsBucketRules: unknown[];
  /** Serialized resources of the grants below, so ARN patterns can be matched. */
  childExecutionDescribeResources: string;
  describeMapRunResources: string;
  listMapRunsResources: string;
  parseKeywordsPutResources: string;
  generateSummaryReadResources: string;
  kpiAlertsReadResources: string;
  generateSummaryMemorySize: number;
  generateSummaryTimeoutSeconds: number;
}

export const EMPTY_WORKFLOW_SCALE_SNAPSHOT: WorkflowScaleSnapshot = {
  definition: undefined,
  keywordsBucketRules: [],
  childExecutionDescribeResources: '',
  describeMapRunResources: '',
  listMapRunsResources: '',
  parseKeywordsPutResources: '',
  generateSummaryReadResources: '',
  kpiAlertsReadResources: '',
  generateSummaryMemorySize: Number.NaN,
  generateSummaryTimeoutSeconds: Number.NaN,
};

/**
 * A state machine definition parsed as JSON. Token parts sit inside string
 * literals (`"arn:" + Ref + ":states:::..."`), so they are replaced by bare
 * text to keep the result valid JSON.
 */
function parseStateMachineDefinition(template: Template, stateMachineName: string): unknown {
  const parts = stateMachineDefinitionParts(template, stateMachineName);
  const parsed: unknown = JSON.parse(parts.map((part) => (typeof part === 'string' ? part : '__TOKEN__')).join(''));
  return parsed;
}

function serializedResources(statements: IamPolicyStatementSnapshot[]): string {
  return JSON.stringify(statements.flatMap((statement) => statement.resources));
}

export function extractWorkflowScaleSnapshot(template: Template): WorkflowScaleSnapshot {
  const functionGrant = (functionName: string, action: string): string =>
    serializedResources(extractFunctionStatementsForAction(template, functionName, action));
  const stepFunctionsRoleId = findLogicalIdByName(template, 'AWS::IAM::Role', 'RoleName', 'CitationAnalysis-StepFunctionsRole');

  return {
    definition: parseStateMachineDefinition(template, 'CitationAnalysis-Workflow'),
    keywordsBucketRules: bucketLifecycleRules(template, 'citation-analysis-keywords'),
    childExecutionDescribeResources: serializedResources(
      roleStatementsForAction(template, stepFunctionsRoleId, 'states:DescribeExecution')
    ),
    describeMapRunResources: functionGrant('CitationAnalysis-API-ExecutionMgmt', 'states:DescribeMapRun'),
    listMapRunsResources: functionGrant('CitationAnalysis-API-ExecutionMgmt', 'states:ListMapRuns'),
    parseKeywordsPutResources: functionGrant('CitationAnalysis-ParseKeywords', 's3:PutObject'),
    generateSummaryReadResources: functionGrant('CitationAnalysis-GenerateSummary', 's3:GetObject*'),
    kpiAlertsReadResources: functionGrant('CitationAnalysis-KpiAlerts', 's3:GetObject*'),
    generateSummaryMemorySize: extractFunctionMemorySize(template, 'CitationAnalysis-GenerateSummary'),
    generateSummaryTimeoutSeconds: extractFunctionTimeout(template, 'CitationAnalysis-GenerateSummary'),
  };
}

/** The providers that get their own `CitationAnalysis-Search-<id>` function (2.28.0). */
export const SEARCH_PROVIDER_IDS = [
  'openai', 'perplexity', 'gemini', 'claude', 'brave', 'tavily', 'exa', 'serpapi', 'firecrawl',
];

export function searchFunctionName(providerId: string): string {
  return `CitationAnalysis-Search-${providerId}`;
}

/** The per-provider search functions as synthesized, keyed by provider id. */
export interface ProviderSearchSnapshot {
  reservedConcurrency: Record<string, number | undefined>;
  timeoutSeconds: Record<string, number>;
  roleLogicalIds: Record<string, string>;
  searchRoleLogicalId: string;
  /** `PROVIDER_THROTTLE_EXTRA_ATTEMPTS` of every function in the stack that sets it, by function name. */
  throttleExtraAttemptsByFunction: Record<string, unknown>;
  /** Logical ids of the single pre-2.28.0 search function and its log group ('' when gone). */
  legacyFunctionLogicalId: string;
  legacyLogGroupLogicalId: string;
}

export const EMPTY_PROVIDER_SEARCH_SNAPSHOT: ProviderSearchSnapshot = {
  reservedConcurrency: {},
  timeoutSeconds: {},
  roleLogicalIds: {},
  searchRoleLogicalId: '',
  throttleExtraAttemptsByFunction: {},
  legacyFunctionLogicalId: '',
  legacyLogGroupLogicalId: '',
};

function byProvider<T>(read: (functionName: string) => T): Record<string, T> {
  return Object.fromEntries(SEARCH_PROVIDER_IDS.map((id) => [id, read(searchFunctionName(id))]));
}

export function extractProviderSearchSnapshot(template: Template): ProviderSearchSnapshot {
  const throttleExtraAttemptsByFunction: Record<string, unknown> = {};
  for (const resource of Object.values(template.findResources('AWS::Lambda::Function'))) {
    const value = resolvePath(resource, ['Properties', 'Environment', 'Variables', 'PROVIDER_THROTTLE_EXTRA_ATTEMPTS']);
    if (value !== undefined) {
      throttleExtraAttemptsByFunction[resolveString(resource, ['Properties', 'FunctionName'])] = value;
    }
  }
  return {
    reservedConcurrency: byProvider((name) => extractReservedConcurrency(template, name)),
    timeoutSeconds: byProvider((name) => extractFunctionTimeout(template, name)),
    roleLogicalIds: byProvider((name) => findFunctionRoleLogicalId(template, name)),
    searchRoleLogicalId: findLogicalIdByName(template, 'AWS::IAM::Role', 'RoleName', 'CitationAnalysis-SearchLambdaRole'),
    throttleExtraAttemptsByFunction,
    legacyFunctionLogicalId: findLambdaLogicalId(template, 'CitationAnalysis-Search'),
    legacyLogGroupLogicalId: findLogicalIdByName(
      template, 'AWS::Logs::LogGroup', 'LogGroupName', '/aws/lambda/CitationAnalysis-Search'
    ),
  };
}

/** The keyword child workflow's states inside ProcessKeywords. */
export function keywordChildStates(definition: unknown): unknown {
  return resolvePath(definition, ['States', 'ProcessKeywords', 'ItemProcessor', 'States']);
}

/** Every SearchAllProviders branch of the keyword child workflow, in definition order. */
function providerSearchBranches(definition: unknown): unknown[] {
  const branches = resolvePath(keywordChildStates(definition), ['SearchAllProviders', 'Branches']);
  return Array.isArray(branches) ? branches : [];
}

/**
 * The SearchAllProviders branch that calls one provider, found by its start
 * state `Search-<id>` so the assertions do not depend on branch order.
 */
export function providerSearchBranch(definition: unknown, providerId: string): unknown {
  return providerSearchBranches(definition)
    .find((branch) => resolvePath(branch, ['StartAt']) === `Search-${providerId}`);
}

/** Every SearchAllProviders branch's start state, in definition order. */
export function providerSearchBranchStarts(definition: unknown): unknown[] {
  return providerSearchBranches(definition).map((branch) => resolvePath(branch, ['StartAt']));
}

export interface CustomReportsSnapshot {
  tableLogicalId: string;
  table: {
    keySchema: unknown;
    billingMode: unknown;
    pointInTimeRecovery: unknown;
    encryption: unknown;
    deletionPolicy: string;
  };
  configMgmtFunctionLogicalId: string;
  configMgmtTableEnv: unknown;
  configMgmtTableActions: string[];
  collectionMethods: ApiGatewayMethodSnapshot[];
  itemMethods: ApiGatewayMethodSnapshot[];
}

export const EMPTY_CUSTOM_REPORTS_SNAPSHOT: CustomReportsSnapshot = {
  tableLogicalId: '',
  table: {
    keySchema: undefined,
    billingMode: undefined,
    pointInTimeRecovery: undefined,
    encryption: undefined,
    deletionPolicy: '',
  },
  configMgmtFunctionLogicalId: '',
  configMgmtTableEnv: undefined,
  configMgmtTableActions: [],
  collectionMethods: [],
  itemMethods: [],
};

/** The saved custom reports table, its ConfigMgmt wiring and its four API verbs, as synthesized. */
export function extractCustomReportsSnapshot(template: Template): CustomReportsSnapshot {
  const tableName = 'CitationAnalysis-CustomReports';
  const configMgmt = 'CitationAnalysis-API-ConfigMgmt';
  const tableLogicalId = findLogicalIdByName(template, 'AWS::DynamoDB::Table', 'TableName', tableName);
  const table: unknown = template.findResources('AWS::DynamoDB::Table')[tableLogicalId];
  const collectionId = findApiResourceId(template, 'custom-reports');
  return {
    tableLogicalId,
    table: {
      keySchema: resolvePath(table, ['Properties', 'KeySchema']),
      billingMode: resolvePath(table, ['Properties', 'BillingMode']),
      pointInTimeRecovery: resolvePath(
        table, ['Properties', 'PointInTimeRecoverySpecification', 'PointInTimeRecoveryEnabled']
      ),
      encryption: resolvePath(table, ['Properties', 'SSESpecification']),
      deletionPolicy: resolveString(table, ['DeletionPolicy']),
    },
    configMgmtFunctionLogicalId: findLambdaLogicalId(template, configMgmt),
    configMgmtTableEnv: extractLambdaEnvVars(template, configMgmt).DYNAMODB_TABLE_CUSTOM_REPORTS,
    configMgmtTableActions: extractFunctionRoleActionsOn(template, configMgmt, tableLogicalId),
    collectionMethods: extractApiMethods(template, collectionId),
    itemMethods: extractApiMethods(template, findApiResourceId(template, '{id}', collectionId)),
  };
}

/** The dashboard CSP from the CloudFront security-headers policy, as `{directive: sources}`. */
export function extractContentSecurityPolicy(template: Template): Record<string, string[]> {
  const [policy] = Object.values(template.findResources('AWS::CloudFront::ResponseHeadersPolicy'));
  const header = resolveString(policy, [
    'Properties', 'ResponseHeadersPolicyConfig', 'SecurityHeadersConfig', 'ContentSecurityPolicy', 'ContentSecurityPolicy',
  ]);
  return Object.fromEntries(
    header
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name !== '')
      .map(([name, ...sources]) => [name, sources])
  );
}

/** Every stack table a function's role grants something on, with the sorted actions, by table name. */
function functionTableActions(template: Template, functionName: string): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(template.findResources('AWS::DynamoDB::Table'))
      .map(([logicalId, table]) => [
        resolveString(table, ['Properties', 'TableName']),
        extractFunctionRoleActionsOn(template, functionName, logicalId),
      ] as const)
      .filter(([, actions]) => actions.length > 0)
  );
}

/** The narrative pieces (2.32.0): GenerateInsights, its worker and table, and the regenerate route. */
export interface ReportInsightsSnapshot {
  /** The workflow's states, tokens replaced by `__TOKEN__`. */
  states: unknown;
  table: {
    keySchema: unknown;
    billingMode: unknown;
    timeToLive: unknown;
  };
  workerTimeoutSeconds: number;
  workerLayerCount: number;
  workerEnvironmentNames: string[];
  workerTableActions: Record<string, string[]>;
  workerActions: string[];
  statsInsightsEnvironment: Record<string, unknown>;
  statsInsightsReportInsightsActions: string[];
  statsInsightsWorkerActions: string[];
  regenerateMethods: ApiGatewayMethodSnapshot[];
  statsInsightsFunctionLogicalId: string;
}

export function extractReportInsightsSnapshot(template: Template): ReportInsightsSnapshot {
  const worker = 'CitationAnalysis-ReportInsights';
  const statsInsights = 'CitationAnalysis-API-StatsInsights';
  const tableName = 'CitationAnalysis-ReportInsights';
  const tableLogicalId = findLogicalIdByName(template, 'AWS::DynamoDB::Table', 'TableName', tableName);
  const insightsResourceId = findApiResourceId(template, 'insights', findApiResourceId(template, 'reports'));
  return {
    states: resolvePath(parseStateMachineDefinition(template, 'CitationAnalysis-Workflow'), ['States']),
    table: {
      keySchema: extractTableKeySchema(template, tableName),
      billingMode: extractTableProperty(template, tableName, 'BillingMode'),
      timeToLive: extractTableProperty(template, tableName, 'TimeToLiveSpecification'),
    },
    workerTimeoutSeconds: extractFunctionTimeout(template, worker),
    workerLayerCount: extractLambdaLayerRefs(template, worker).length,
    workerEnvironmentNames: Object.keys(extractLambdaEnvVars(template, worker)).sort((left, right) => left.localeCompare(right)),
    workerTableActions: functionTableActions(template, worker),
    workerActions: extractFunctionRoleActions(template, worker),
    statsInsightsEnvironment: extractLambdaEnvVars(template, statsInsights),
    statsInsightsReportInsightsActions: extractFunctionRoleActionsOn(template, statsInsights, tableLogicalId),
    statsInsightsWorkerActions: extractFunctionRoleActionsOn(template, statsInsights, findLambdaLogicalId(template, worker)),
    regenerateMethods: extractApiMethods(template, findApiResourceId(template, 'regenerate', insightsResourceId)),
    statsInsightsFunctionLogicalId: findLambdaLogicalId(template, statsInsights),
  };
}
