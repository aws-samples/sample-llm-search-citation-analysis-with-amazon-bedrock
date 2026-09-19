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

export function verbsWithoutCognitoAuthorizer(methods: ApiGatewayMethodSnapshot[]): string[] {
  return methods
    .filter((method) => method.authorizationType !== COGNITO_AUTH)
    .map((method) => method.httpMethod);
}

export function verbsNotIntegratedWith(
  methods: ApiGatewayMethodSnapshot[],
  functionLogicalId: string
): string[] {
  return methods
    .filter((method) => !method.integrationUri.includes(functionLogicalId))
    .map((method) => method.httpMethod);
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

export interface CrawlerInfrastructureSnapshot {
  crawledContentTableIndexes: unknown;
  crawlerEnvVars: Record<string, unknown>;
  crawlerRoleCrawledContentActions: string[];
  browserSigningRoleActions: string[];
  browserSigningTrustConditions: unknown;
}

/** Crawler-specific synthesized values shared by the cache and signing-role suites. */
export function extractCrawlerInfrastructureSnapshot(
  template: Template
): CrawlerInfrastructureSnapshot {
  const crawlerFunctionName = 'CitationAnalysis-Crawler';
  const crawlerRoleName = 'CitationAnalysis-CrawlerLambdaRole';
  const crawledContentTableName = 'CitationAnalysis-CrawledContent';
  const browserSigningRoleName = 'CitationAnalysis-BrowserSigningRole';
  const browserSigningRoleId = findLogicalIdByName(
    template,
    'AWS::IAM::Role',
    'RoleName',
    browserSigningRoleName
  );
  const browserSigningRoles = template.findResources('AWS::IAM::Role', {
    Properties: { RoleName: browserSigningRoleName },
  });

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
    browserSigningRoleActions: sortedUnique(
      allowStatementsOfRole(template, browserSigningRoleId).flatMap(statementActions)
    ),
    browserSigningTrustConditions: resolvePath(
      browserSigningRoles[browserSigningRoleId],
      ['Properties', 'AssumeRolePolicyDocument', 'Statement', '0', 'Condition']
    ),
  };
}
