import { Template } from 'aws-cdk-lib/assertions';

const PREFLIGHT_METHOD = 'OPTIONS';
const COGNITO_AUTH = 'COGNITO_USER_POOLS';

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

export interface WebAclSnapshot {
  logicalId: string;
  name: string;
  scope: string;
  associated: boolean;
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

/** Logical id of the IAM role a Lambda function executes as. */
export function findFunctionRoleLogicalId(template: Template, functionName: string): string {
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  return collectGetAttTargets(
    resolvePath(functions[Object.keys(functions)[0] ?? ''], ['Properties', 'Role'])
  )[0] ?? '';
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

/** Extract a Step Functions definition JSON from the synthesized template. */
export function extractStateMachineDefinition(template: Template, stateMachineName: string): string {
  const joinArgs = resolvePath(findStateMachine(template, stateMachineName), ['Properties', 'DefinitionString', 'Fn::Join']);
  const parts = Array.isArray(joinArgs) && Array.isArray(joinArgs[1]) ? joinArgs[1] : [];
  return parts
    .map((part) => (typeof part === 'string' ? part : '"__REF__"'))
    .join('');
}

export function extractLambdaEnvVars(template: Template, functionName: string): Record<string, unknown> {
  const lambdas = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  const logicalId = Object.keys(lambdas)[0];
  const envVars = resolvePath(lambdas[logicalId], ['Properties', 'Environment', 'Variables']);
  return isRecord(envVars) ? envVars : {};
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
  const lambdas = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  const logicalId = Object.keys(lambdas)[0];
  const value = resolvePath(lambdas[logicalId], ['Properties', 'ReservedConcurrentExecutions']);
  return typeof value === 'number' ? value : undefined;
}

export function findLambdaLogicalId(template: Template, functionName: string): string {
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  return Object.keys(functions)[0] ?? '';
}

export function extractLambdaLayerRefs(template: Template, functionName: string): string[] {
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  const logicalId = Object.keys(functions)[0];
  const layers = resolvePath(functions[logicalId], ['Properties', 'Layers']);
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

export function extractFunctionTimeout(template: Template, functionName: string): number {
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  const timeout = resolvePath(functions[Object.keys(functions)[0] ?? ''], ['Properties', 'Timeout']);
  return typeof timeout === 'number' ? timeout : Number.NaN;
}

export function extractFunctionMemorySize(template: Template, functionName: string): number {
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  const memory = resolvePath(functions[Object.keys(functions)[0] ?? ''], ['Properties', 'MemorySize']);
  return typeof memory === 'number' ? memory : Number.NaN;
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

export function allowStatementsOfRole(template: Template, roleLogicalId: string): unknown[] {
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((policy) => policyAttachedToRole(policy, roleLogicalId))
    .flatMap((policy): unknown[] => {
      const statements = resolvePath(policy, ['Properties', 'PolicyDocument', 'Statement']);
      return (Array.isArray(statements) ? statements : [])
        .filter((statement) => resolveString(statement, ['Effect']) === 'Allow');
    });
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

function extractFunctionStatementsForAction(
  template: Template,
  functionName: string,
  action: string
): IamPolicyStatementSnapshot[] {
  const roleId = findFunctionRoleLogicalId(template, functionName);
  return allowStatementsOfRole(template, roleId)
    .filter((statement) => statementActions(statement).includes(action))
    .map((statement) => ({
      actions: sortedUnique(statementActions(statement)),
      resources: statementResources(statement),
    }));
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

export function extractApiAuthSnapshots(template: Template): ApiMethodAuthSnapshot[] {
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

export function extractWebAcls(template: Template): WebAclSnapshot[] {
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

export function extractBucketLifecycle(template: Template, namePrefix: string): BucketLifecycleSnapshot {
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

export interface IamPolicyStatementSnapshot {
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
  const crawlerRoleBrowserStatements = allowStatementsOfRole(template, crawlerRoleId)
    .filter((statement) => statementActions(statement).some(isCrawlerBrowserAction))
    .map((statement) => ({
      actions: sortedUnique(statementActions(statement)),
      resources: statementResources(statement),
    }));

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


export const STATUS_CREATED_INDEX_SCHEMA = {
  IndexName: 'StatusCreatedIndex',
  KeySchema: [
    { AttributeName: 'status', KeyType: 'HASH' },
    { AttributeName: 'created_at', KeyType: 'RANGE' },
  ],
  Projection: { ProjectionType: 'ALL' },
};

export interface ContentStudioRouteSnapshot extends ApiMethodAuthSnapshot {
  integrationUri: string;
}

export interface ContentStudioEventSourceSnapshot {
  batchSize: number | undefined;
  startingPosition: string;
  retryAttempts: number | undefined;
  maxRecordAgeSeconds: number | undefined;
  filterPatterns: string[];
  tableLogicalIds: string[];
  functionLogicalIds: string[];
  onFailureQueueLogicalIds: string[];
}

export interface ContentStudioStreamDlqSnapshot {
  logicalId: string;
  queueName: string;
  retentionSeconds: number | undefined;
  sqsManagedSseEnabled: boolean | undefined;
  sslEnforced: boolean;
  workerActions: string[];
  alarmCount: number;
}

export interface ContentStudioReconcileRuleSnapshot {
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
  const routes = Object.values(
    template.findResources('AWS::ApiGateway::Method')
  ).flatMap((method): ContentStudioRouteSnapshot[] => {
    const httpMethod = resolveString(method, ['Properties', 'HttpMethod']);
    const resourceId = resolveString(method, ['Properties', 'ResourceId', 'Ref']);
    const routePath = resourcePaths.get(resourceId) ?? '/';
    if (httpMethod === PREFLIGHT_METHOD || !routePath.startsWith('/api/content-studio')) {
      return [];
    }
    return [{
      path: routePath,
      httpMethod,
      authorizationType: resolveString(method, ['Properties', 'AuthorizationType']),
      authorizerId: resolveString(method, ['Properties', 'AuthorizerId', 'Ref']),
      integrationUri: JSON.stringify(
        resolvePath(method, ['Properties', 'Integration', 'Uri'])
      ) ?? '',
    }];
  });
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
