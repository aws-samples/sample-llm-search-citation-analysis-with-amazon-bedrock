import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  describe, it, expect, beforeAll
} from 'vitest';
import { CitationAnalysisStack } from './citation-analysis-stack';
import {
  allowStatementsOfRole,
  collectRefTargets,
  extractApiAuthSnapshots,
  extractApiBackedFunctionTimeouts,
  extractApiMethods,
  extractBucketLifecycle,
  extractCrawlerInfrastructureSnapshot,
  extractDefinitionTimeoutSeconds,
  extractFunctionMemorySize,
  extractFunctionRoleActions,
  extractFunctionRoleActionsOn,
  extractFunctionTimeout,
  extractLambdaEnvVars,
  extractLambdaLayerRefs,
  extractLambdaLogGroups,
  extractMemorySizesByLogicalIdPrefix,
  extractProdStageMethodSettings,
  extractReservedConcurrency,
  extractRoleTableActions,
  extractStateMachineDefinition,
  extractStateMachineLogging,
  extractTableKeySchema,
  extractTableProperty,
  extractUserPoolClientProps,
  extractUserPoolGroupNames,
  extractWebAcls,
  findApiResourceId,
  findFunctionRoleLogicalId,
  findLambdaLogicalId,
  findLogicalIdByName,
  findStateMachineLogicalId,
  resolvePath,
  resolveString,
  retentionForLogGroupName,
  statementActions,
  tokenValidityMinutes,
  unguardedVerbs,
  type ApiGatewayMethodSnapshot,
  type ApiMethodAuthSnapshot,
  type BucketLifecycleSnapshot,
  type IamPolicyStatementSnapshot,
  type LambdaLogGroupSnapshot,
  type StageMethodSettingSnapshot,
  type StateMachineLoggingSnapshot,
  type WebAclSnapshot,
} from './citation-analysis-stack-fixtures';

const KEYWORD_MGMT_FUNCTION_NAME = 'CitationAnalysis-API-KeywordMgmt';
const CONTENT_STUDIO_FUNCTION_NAME = 'CitationAnalysis-API-ContentStudio';
const SELF_INVOKING_CONCURRENCY = 10;

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

interface GatewayResponseSnapshot {
  responseType: string;
  statusCode: string;
  responseParameters: unknown;
}

const synthesized: {
  definitionRaw: string;
  researchDefinitionRaw: string;
  researchStateMachineTimeoutSeconds: number;
  researchWorkerTimeoutSeconds: number;
  researchWorkerLayerRefs: string[];
  keywordResearchTableIndexes: unknown;
  crawledContentTableIndexes: unknown;
  keywordResearchTableTtl: unknown;
  keywordResearchIdMethods: ApiGatewayMethodSnapshot[];
  keywordResearchRetryMethods: ApiGatewayMethodSnapshot[];
  keywordResearchAgentMethods: ApiGatewayMethodSnapshot[];
  researchTemplatesMethods: ApiGatewayMethodSnapshot[];
  researchTemplateIdMethods: ApiGatewayMethodSnapshot[];
  researchTemplatesTableKeySchema: unknown;
  researchWorkerEnvVars: Record<string, unknown>;
  researchWorkerRoleActions: string[];
  healthCheckMemorySize: number;
  statsInsightsMemorySize: number;
  bucketDeploymentMemorySizes: number[];
  gatewayResponses: GatewayResponseSnapshot[];
  schedulesMethods: ApiGatewayMethodSnapshot[];
  scheduleIdMethods: ApiGatewayMethodSnapshot[];
  scheduleRunMethods: ApiGatewayMethodSnapshot[];
  configMgmtFunctionId: string;
  configMgmtEnvVars: Record<string, unknown>;
  configMgmtStateMachineActions: string[];
  scopedReadFunctionEnvVars: Record<string, Record<string, unknown>>;
  crawlerEnvVars: Record<string, unknown>;
  crawlerRoleCrawledContentActions: string[];
  crawlerBrowserLogicalId: string;
  crawlerRoleBrowserStatements: IamPolicyStatementSnapshot[];
  browserSigningRoleActions: string[];
  browserSigningTrustConditions: unknown;
  parseKeywordsEnvVars: Record<string, unknown>;
  keywordMgmtEnvVars: Record<string, unknown>;
  executionMgmtEnvVars: Record<string, unknown>;
  keywordMgmtFunctionId: string;
  promoteMethods: ApiGatewayMethodSnapshot[];
  keywordIdMethods: ApiGatewayMethodSnapshot[];
  keywordGroupsMethods: ApiGatewayMethodSnapshot[];
  keywordGroupIdMethods: ApiGatewayMethodSnapshot[];
  keywordGroupMembersMethods: ApiGatewayMethodSnapshot[];
  keywordGroupsTableKeySchema: unknown;
  healthCheckLayerRefs: string[];
  apiAuthSnapshots: ApiMethodAuthSnapshot[];
  userPoolClientProps: Record<string, unknown>;
  userPoolGroupNames: string[];
  contentStudioConcurrency: number | undefined;
  contentStudioKeywordGroupsEnvRef: string;
  contentStudioKeywordGroupsTableId: string;
  contentStudioKeywordGroupsActions: string[];
  groupBriefTableNames: string[];
  keywordMgmtConcurrency: number | undefined;
  outputKeys: string[];
  apiBackedFunctionTimeouts: Record<string, number>;
  apiLambdaLogGroups: LambdaLogGroupSnapshot[];
  workerLogGroupRetention: Map<string, number>;
  stateMachineLogging: StateMachineLoggingSnapshot;
  researchStateMachineLogging: StateMachineLoggingSnapshot;
  prodStageMethodSettings: StageMethodSettingSnapshot[];
  webAcls: WebAclSnapshot[];
  cloudFrontWafResourceIds: string[];
  screenshotsLifecycle: BucketLifecycleSnapshot;
  accessLogsLifecycle: BucketLifecycleSnapshot;
  searchRoleProviderConfigActions: string[];
} = {
  definitionRaw: '',
  researchDefinitionRaw: '',
  researchStateMachineTimeoutSeconds: Number.NaN,
  researchWorkerTimeoutSeconds: Number.NaN,
  researchWorkerLayerRefs: [],
  keywordResearchTableIndexes: undefined,
  crawledContentTableIndexes: undefined,
  keywordResearchTableTtl: undefined,
  keywordResearchIdMethods: [],
  keywordResearchRetryMethods: [],
  keywordResearchAgentMethods: [],
  researchTemplatesMethods: [],
  researchTemplateIdMethods: [],
  researchTemplatesTableKeySchema: undefined,
  researchWorkerEnvVars: {},
  researchWorkerRoleActions: [],
  healthCheckMemorySize: Number.NaN,
  statsInsightsMemorySize: Number.NaN,
  bucketDeploymentMemorySizes: [],
  gatewayResponses: [],
  schedulesMethods: [],
  scheduleIdMethods: [],
  scheduleRunMethods: [],
  configMgmtFunctionId: '',
  configMgmtEnvVars: {},
  configMgmtStateMachineActions: [],
  scopedReadFunctionEnvVars: {},
  crawlerEnvVars: {},
  crawlerRoleCrawledContentActions: [],
  crawlerBrowserLogicalId: '',
  crawlerRoleBrowserStatements: [],
  browserSigningRoleActions: [],
  browserSigningTrustConditions: {},
  parseKeywordsEnvVars: {},
  keywordMgmtEnvVars: {},
  executionMgmtEnvVars: {},
  keywordMgmtFunctionId: '',
  promoteMethods: [],
  keywordIdMethods: [],
  keywordGroupsMethods: [],
  keywordGroupIdMethods: [],
  keywordGroupMembersMethods: [],
  keywordGroupsTableKeySchema: undefined,
  healthCheckLayerRefs: [],
  apiAuthSnapshots: [],
  userPoolClientProps: {},
  userPoolGroupNames: [],
  contentStudioConcurrency: undefined,
  contentStudioKeywordGroupsEnvRef: '',
  contentStudioKeywordGroupsTableId: '',
  contentStudioKeywordGroupsActions: [],
  groupBriefTableNames: [],
  keywordMgmtConcurrency: undefined,
  outputKeys: [],
  apiBackedFunctionTimeouts: {},
  apiLambdaLogGroups: [],
  workerLogGroupRetention: new Map(),
  stateMachineLogging: { level: '', includesExecutionData: false, destinationRetentionDays: Number.NaN },
  researchStateMachineLogging: { level: '', includesExecutionData: false, destinationRetentionDays: Number.NaN },
  prodStageMethodSettings: [],
  webAcls: [],
  cloudFrontWafResourceIds: [],
  screenshotsLifecycle: { transitions: [], expirationDays: [] },
  accessLogsLifecycle: { transitions: [], expirationDays: [] },
  searchRoleProviderConfigActions: [],
};

/**
 * The Step Functions workers, which have carried explicit log groups since
 * they were written. Listed so the API-side fix cannot be delivered by
 * regressing the functions that were already correct.
 */
const WORKER_LOG_GROUP_NAMES = [
  '/aws/lambda/CitationAnalysis-ParseKeywords',
  '/aws/lambda/CitationAnalysis-Search',
  '/aws/lambda/CitationAnalysis-Deduplication',
  '/aws/lambda/CitationAnalysis-Crawler',
  '/aws/lambda/CitationAnalysis-GenerateSummary',
  '/aws/lambda/CitationAnalysis-KpiAlerts',
  '/aws/lambda/CitationAnalysis-ResearchWorker',
];

const WORKFLOW_STATE_MACHINE = 'CitationAnalysis-Workflow';
const CONFIG_MGMT_FUNCTION_NAME = 'CitationAnalysis-API-ConfigMgmt';

/**
 * The read functions that resolve `group_id` / `keyword_ids` report scopes
 * (2.4.0). Each needs the keywords table to turn a scope into keyword texts.
 */
const SCOPED_READ_FUNCTION_NAMES = [
  'CitationAnalysis-API-StatsInsights',
  'CitationAnalysis-API-CitationsContent',
  'CitationAnalysis-API-GetBrandMentions',
];
const RESEARCH_STATE_MACHINE = 'CitationAnalysis-KeywordResearch';
const RESEARCH_WORKER_FUNCTION_NAME = 'CitationAnalysis-ResearchWorker';

beforeAll(() => {
  const app = new cdk.App();
  const stack = new CitationAnalysisStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  synthesized.definitionRaw = extractStateMachineDefinition(template, WORKFLOW_STATE_MACHINE);
  synthesized.researchDefinitionRaw = extractStateMachineDefinition(template, RESEARCH_STATE_MACHINE);
  synthesized.researchStateMachineTimeoutSeconds = extractDefinitionTimeoutSeconds(synthesized.researchDefinitionRaw);
  synthesized.researchWorkerTimeoutSeconds = extractFunctionTimeout(template, RESEARCH_WORKER_FUNCTION_NAME);
  synthesized.researchWorkerLayerRefs = extractLambdaLayerRefs(template, RESEARCH_WORKER_FUNCTION_NAME);
  synthesized.keywordResearchTableIndexes = extractTableProperty(template, 'CitationAnalysis-KeywordResearch', 'GlobalSecondaryIndexes');
  synthesized.keywordResearchTableTtl = extractTableProperty(template, 'CitationAnalysis-KeywordResearch', 'TimeToLiveSpecification');
  Object.assign(synthesized, extractCrawlerInfrastructureSnapshot(template));
  synthesized.parseKeywordsEnvVars = extractLambdaEnvVars(template, 'CitationAnalysis-ParseKeywords');
  synthesized.keywordMgmtEnvVars = extractLambdaEnvVars(template, KEYWORD_MGMT_FUNCTION_NAME);
  synthesized.executionMgmtEnvVars = extractLambdaEnvVars(template, 'CitationAnalysis-API-ExecutionMgmt');
  synthesized.keywordMgmtFunctionId = findLambdaLogicalId(template, KEYWORD_MGMT_FUNCTION_NAME);

  const keywordsId = findApiResourceId(template, 'keywords');
  const promoteId = findApiResourceId(template, 'promote', keywordsId);
  const keywordId = findApiResourceId(template, '{id}', keywordsId);
  synthesized.promoteMethods = extractApiMethods(template, promoteId);
  synthesized.keywordIdMethods = extractApiMethods(template, keywordId);

  const keywordGroupsId = findApiResourceId(template, 'keyword-groups');
  const keywordGroupId = findApiResourceId(template, '{id}', keywordGroupsId);
  const keywordGroupMembersId = findApiResourceId(template, 'keywords', keywordGroupId);
  synthesized.keywordGroupsMethods = extractApiMethods(template, keywordGroupsId);
  synthesized.keywordGroupIdMethods = extractApiMethods(template, keywordGroupId);
  synthesized.keywordGroupMembersMethods = extractApiMethods(template, keywordGroupMembersId);
  synthesized.keywordGroupsTableKeySchema = extractTableKeySchema(template, 'CitationAnalysis-KeywordGroups');

  const keywordResearchId = findApiResourceId(template, 'keyword-research');
  const keywordResearchJobId = findApiResourceId(template, '{id}', keywordResearchId);
  const keywordResearchRetryId = findApiResourceId(template, 'retry', keywordResearchJobId);
  synthesized.keywordResearchIdMethods = extractApiMethods(template, keywordResearchJobId);
  synthesized.keywordResearchRetryMethods = extractApiMethods(template, keywordResearchRetryId);
  const keywordResearchAgentId = findApiResourceId(template, 'agent', keywordResearchId);
  const researchTemplatesId = findApiResourceId(template, 'templates', keywordResearchId);
  const researchTemplateId = findApiResourceId(template, '{id}', researchTemplatesId);
  synthesized.keywordResearchAgentMethods = extractApiMethods(template, keywordResearchAgentId);
  synthesized.researchTemplatesMethods = extractApiMethods(template, researchTemplatesId);
  synthesized.researchTemplateIdMethods = extractApiMethods(template, researchTemplateId);
  synthesized.researchTemplatesTableKeySchema = extractTableKeySchema(template, 'CitationAnalysis-ResearchTemplates');
  synthesized.researchWorkerEnvVars = extractLambdaEnvVars(template, RESEARCH_WORKER_FUNCTION_NAME);
  synthesized.researchWorkerRoleActions = extractFunctionRoleActions(template, RESEARCH_WORKER_FUNCTION_NAME);
  synthesized.healthCheckMemorySize = extractFunctionMemorySize(template, 'CitationAnalysis-API-Health');
  synthesized.statsInsightsMemorySize = extractFunctionMemorySize(template, 'CitationAnalysis-API-StatsInsights');
  synthesized.bucketDeploymentMemorySizes = extractMemorySizesByLogicalIdPrefix(template, 'CustomCDKBucketDeployment');
  synthesized.gatewayResponses = Object.values(
    template.findResources('AWS::ApiGateway::GatewayResponse')
  ).map((response) => ({
    responseType: resolveString(response, ['Properties', 'ResponseType']),
    statusCode: resolveString(response, ['Properties', 'StatusCode']),
    responseParameters: resolvePath(response, ['Properties', 'ResponseParameters']),
  }));

  const schedulesId = findApiResourceId(template, 'schedules');
  const scheduleId = findApiResourceId(template, '{name}', schedulesId);
  const scheduleRunId = findApiResourceId(template, 'run', scheduleId);
  synthesized.schedulesMethods = extractApiMethods(template, schedulesId);
  synthesized.scheduleIdMethods = extractApiMethods(template, scheduleId);
  synthesized.scheduleRunMethods = extractApiMethods(template, scheduleRunId);
  synthesized.configMgmtFunctionId = findLambdaLogicalId(template, CONFIG_MGMT_FUNCTION_NAME);
  synthesized.configMgmtEnvVars = extractLambdaEnvVars(template, CONFIG_MGMT_FUNCTION_NAME);
  synthesized.configMgmtStateMachineActions = extractFunctionRoleActionsOn(
    template, CONFIG_MGMT_FUNCTION_NAME, findStateMachineLogicalId(template, WORKFLOW_STATE_MACHINE)
  );
  synthesized.scopedReadFunctionEnvVars = Object.fromEntries(
    SCOPED_READ_FUNCTION_NAMES.map((name) => [name, extractLambdaEnvVars(template, name)])
  );
  synthesized.healthCheckLayerRefs = extractLambdaLayerRefs(template, 'CitationAnalysis-API-Health');

  synthesized.apiAuthSnapshots = extractApiAuthSnapshots(template);
  synthesized.userPoolClientProps = extractUserPoolClientProps(template);
  synthesized.userPoolGroupNames = extractUserPoolGroupNames(template);

  const contentStudioEnvVars = extractLambdaEnvVars(template, CONTENT_STUDIO_FUNCTION_NAME);
  const keywordGroupsTableId = findLogicalIdByName(
    template,
    'AWS::DynamoDB::Table',
    'TableName',
    'CitationAnalysis-KeywordGroups'
  );
  synthesized.contentStudioKeywordGroupsEnvRef = collectRefTargets(
    contentStudioEnvVars.DYNAMODB_TABLE_KEYWORD_GROUPS
  )[0] ?? '';
  synthesized.contentStudioKeywordGroupsTableId = keywordGroupsTableId;
  synthesized.contentStudioKeywordGroupsActions = extractFunctionRoleActionsOn(
    template,
    CONTENT_STUDIO_FUNCTION_NAME,
    keywordGroupsTableId
  );
  synthesized.groupBriefTableNames = Object.values(
    template.findResources('AWS::DynamoDB::Table')
  )
    .map((resource) => resolveString(resource, ['Properties', 'TableName']))
    .filter((tableName) => /(?:Group|Content)Brief/u.test(tableName));
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

  synthesized.stateMachineLogging = extractStateMachineLogging(template, WORKFLOW_STATE_MACHINE);
  synthesized.researchStateMachineLogging = extractStateMachineLogging(template, RESEARCH_STATE_MACHINE);
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

  it('still has both documented exceptions wired to the API', () => {
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

  it('caps Keyword Management now that research runs in its own state machine', () => {
    /**
     * Held a 120s exception while it invoked itself to run research in the
     * background. Since 2.2.0 it only starts executions and reads rows.
     */
    expect(synthesized.apiBackedFunctionTimeouts[KEYWORD_MGMT_FUNCTION_NAME]).toBe(GATEWAY_CEILING);
  });
});

describe('Content Studio group brief infrastructure', () => {
  it('points the group environment variable at the existing KeywordGroups table', () => {
    expect(synthesized.contentStudioKeywordGroupsEnvRef).toBe(
      synthesized.contentStudioKeywordGroupsTableId
    );
  });

  it('grants Content Studio read-only access to KeywordGroups', () => {
    expect(synthesized.contentStudioKeywordGroupsActions).toStrictEqual([
      'dynamodb:BatchGetItem',
      'dynamodb:ConditionCheckItem',
      'dynamodb:DescribeTable',
      'dynamodb:GetItem',
      'dynamodb:GetRecords',
      'dynamodb:GetShardIterator',
      'dynamodb:Query',
      'dynamodb:Scan',
    ]);
  });

  it('adds no dedicated group brief table', () => {
    expect(synthesized.groupBriefTableNames).toStrictEqual([]);
  });
});

describe('Self-invoking Lambda concurrency caps', () => {
  /**
   * AUDIT-2026-08-19 §2.4. Content Studio re-invokes itself asynchronously
   * for background work, and async invocations are retried twice by default.
   * Without a ceiling, a bug in a self-invoke guard consumes the account's
   * whole concurrency pool — starving every other function, manage-users
   * included — while billing an LLM call per invocation.
   */

  it('caps Content Studio, which self-invokes for content generation', () => {
    expect(synthesized.contentStudioConcurrency).toBe(SELF_INVOKING_CONCURRENCY);
  });

  it('no longer reserves concurrency for Keyword Management, which stopped self-invoking', () => {
    /**
     * Reserved concurrency also *takes* capacity from the account pool. With
     * research in its own state machine there is no loop left to bound, so the
     * function shares the pool like every other API function.
     */
    expect(synthesized.keywordMgmtConcurrency).toBeUndefined();
  });

  it('keeps the cap small enough to bound a runaway loop', () => {
    /**
     * The account default is ~1000. A cap only helps if it is far below that,
     * so this fails if someone "fixes" a throttling complaint by raising it to
     * something that no longer bounds anything.
     */
    expect(synthesized.contentStudioConcurrency).toBeLessThanOrEqual(50);
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

describe('Keyword research state machine', () => {
  /**
   * 2.2.0: keyword research left the API Lambda's self-invoke path for a
   * dedicated state machine. One execution per job, one parallel step per
   * web-search provider, every step checkpointed into the job row.
   */
  const SWEEP_THRESHOLD_SECONDS = 35 * 60;

  it('fans out one step per provider through a Map that fails steps, not the job', () => {
    expect(synthesized.researchDefinitionRaw).toContain('"ItemsPath":"$.steps"');
    expect(synthesized.researchDefinitionRaw).toContain('"step_id.$":"$$.Map.Item.Value.step_id"');
    expect(synthesized.researchDefinitionRaw).toContain('"action":"fail_step"');
  });

  it('passes attempt ownership and target round into planning', () => {
    expect(synthesized.researchDefinitionRaw).toContain(
      '"action":"plan","job_id.$":"$.job_id","retry.$":"$.retry","attempt.$":"$.attempt","expected_round.$":"$.expected_round","execution_arn.$":"$$.Execution.Id","execution_id.$":"$$.Execution.Name"'
    );
  });

  it('passes attempt ownership and planned round into provider checkpoints', () => {
    expect(synthesized.researchDefinitionRaw).toContain(
      '"ItemSelector":{"action":"execute_step","job_id.$":"$.job_id","step_id.$":"$$.Map.Item.Value.step_id","provider.$":"$$.Map.Item.Value.provider","attempt.$":"$.attempt","expected_round.$":"$.expected_round","execution_arn.$":"$$.Execution.Id","execution_id.$":"$$.Execution.Name"}'
    );
  });

  it('passes attempt ownership and planned round into evaluation', () => {
    expect(synthesized.researchDefinitionRaw).toContain(
      '"action":"evaluate","job_id.$":"$.job_id","attempt.$":"$.attempt","expected_round.$":"$.expected_round","execution_arn.$":"$$.Execution.Id","execution_id.$":"$$.Execution.Name"'
    );
  });

  it('passes attempt ownership and evaluated round into finalization', () => {
    expect(synthesized.researchDefinitionRaw).toContain(
      '"action":"finalize","job_id.$":"$.job_id","attempt.$":"$.attempt","expected_round.$":"$.round","execution_arn.$":"$$.Execution.Id","execution_id.$":"$$.Execution.Name"'
    );
  });

  it('passes attempt ownership and planned round into step failure checkpoints', () => {
    expect(synthesized.researchDefinitionRaw).toContain(
      '"action":"fail_step","job_id.$":"$.job_id","step_id.$":"$.step_id","provider.$":"$.provider","attempt.$":"$.attempt","expected_round.$":"$.expected_round","execution_arn.$":"$$.Execution.Id","execution_id.$":"$$.Execution.Name","error.$":"$.error"'
    );
  });

  it('passes attempt ownership and observed round into whole-job failure checkpoints', () => {
    expect(synthesized.researchDefinitionRaw).toContain(
      '"action":"fail","job_id.$":"$.job_id","attempt.$":"$.attempt","expected_round.$":"$.expected_round","execution_arn.$":"$$.Execution.Id","execution_id.$":"$$.Execution.Name","error.$":"$.error"'
    );
  });

  it('marks the job failed when planning or finalizing crashes', () => {
    expect(synthesized.researchDefinitionRaw).toContain('"action":"fail"');
    expect(synthesized.researchDefinitionRaw).toContain('"Type":"Fail"');
  });

  it('times out below the API sweep threshold so a live job is never swept', () => {
    /**
     * `shared/research_jobs.RESEARCH_STALE_AFTER_SECONDS` marks jobs failed
     * after 35 minutes. An execution allowed to outlive that could finish
     * after being failed and flip the row back — the inversion the sweep
     * exists to avoid.
     */
    expect(synthesized.researchStateMachineTimeoutSeconds).toBe(30 * 60);
    expect(synthesized.researchStateMachineTimeoutSeconds).toBeLessThan(SWEEP_THRESHOLD_SECONDS);
  });

  it('gives the worker minutes per step, since Step Functions is its only invoker', () => {
    expect(synthesized.researchWorkerTimeoutSeconds).toBe(300);
  });

  it('attaches the shared layer the worker imports from', () => {
    expect(synthesized.researchWorkerLayerRefs).toHaveLength(1);
    expect(synthesized.researchWorkerLayerRefs[0]).toMatch(/^SharedLayer/);
  });

  it('hands the state machine ARN to the API function that starts executions', () => {
    expect(synthesized.keywordMgmtEnvVars).toHaveProperty('RESEARCH_STATE_MACHINE_ARN');
  });

  it('logs every state with execution data to a 30-day group', () => {
    expect(synthesized.researchStateMachineLogging).toStrictEqual({
      level: 'ALL',
      includesExecutionData: true,
      destinationRetentionDays: RETENTION_DAYS,
    });
  });
});

describe('Keyword research table', () => {
  it('indexes jobs by type and creation time so history is a query, not a scan', () => {
    expect(synthesized.keywordResearchTableIndexes).toStrictEqual([{
      IndexName: 'TypeCreatedIndex',
      KeySchema: [
        { AttributeName: 'type', KeyType: 'HASH' },
        { AttributeName: 'created_at', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    }]);
  });

  it('expires rows through the ttl attribute the job writer sets', () => {
    expect(synthesized.keywordResearchTableTtl).toStrictEqual({ AttributeName: 'ttl', Enabled: true });
  });
});

describe('Keyword research routes', () => {
  it('exposes GET and DELETE on the job id resource', () => {
    const verbs = synthesized.keywordResearchIdMethods.map((method) => method.httpMethod).sort((a, b) => a.localeCompare(b));

    expect(verbs).toStrictEqual(['DELETE', 'GET']);
  });

  it('exposes POST only on the retry sub-resource', () => {
    expect(synthesized.keywordResearchRetryMethods.map((method) => method.httpMethod)).toStrictEqual(['POST']);
  });

  it('requires the Cognito authorizer on every job route', () => {
    const all = [...synthesized.keywordResearchIdMethods, ...synthesized.keywordResearchRetryMethods];

    expect(all).toHaveLength(3);
    expect(unguardedVerbs(all, synthesized.keywordMgmtFunctionId)).toStrictEqual({
      withoutCognitoAuthorizer: [],
      notIntegratedWithFunction: [],
    });
  });
});

describe('Research agent (2.5.0)', () => {
  /**
   * The agent reuses the research state machine: Evaluate runs after every
   * Map and a Choice loops back to Plan while the worker says `continue`.
   */
  it('evaluates every round and loops back to Plan on continue', () => {
    expect(synthesized.researchDefinitionRaw).toContain('"action":"evaluate"');
    expect(synthesized.researchDefinitionRaw).toContain('"Type":"Choice"');
    expect(synthesized.researchDefinitionRaw).toContain('"Variable":"$.decision"');
    expect(synthesized.researchDefinitionRaw).toContain('"StringEquals":"continue"');
  });

  it('lets the worker call Bedrock for planning, evaluation and selection', () => {
    expect(synthesized.researchWorkerRoleActions).toContain('bedrock:InvokeModel');
  });

  it('routes planning to the balanced tier and evaluation to the fast tier', () => {
    expect(synthesized.researchWorkerEnvVars).toMatchObject({
      BEDROCK_TIER_RESEARCH_PLANNING: 'balanced',
      BEDROCK_TIER_RESEARCH_EVALUATION: 'fast',
    });
  });

  it('stores saved system prompts in a table keyed by id and hands it to the API function', () => {
    expect(synthesized.researchTemplatesTableKeySchema).toStrictEqual([{ AttributeName: 'id', KeyType: 'HASH' }]);
    expect(synthesized.keywordMgmtEnvVars).toHaveProperty('DYNAMODB_TABLE_RESEARCH_TEMPLATES');
  });

  it('exposes POST on the agent resource', () => {
    expect(synthesized.keywordResearchAgentMethods.map((method) => method.httpMethod)).toStrictEqual(['POST']);
  });

  it('exposes GET and POST on the templates collection and PUT and DELETE on a template', () => {
    const collection = synthesized.researchTemplatesMethods.map((method) => method.httpMethod).sort((a, b) => a.localeCompare(b));
    const single = synthesized.researchTemplateIdMethods.map((method) => method.httpMethod).sort((a, b) => a.localeCompare(b));

    expect(collection).toStrictEqual(['GET', 'POST']);
    expect(single).toStrictEqual(['DELETE', 'PUT']);
  });

  it('requires the Cognito authorizer and the KeywordMgmt integration on every agent route', () => {
    const all = [...synthesized.keywordResearchAgentMethods, ...synthesized.researchTemplatesMethods, ...synthesized.researchTemplateIdMethods];

    expect(all).toHaveLength(5);
    expect(unguardedVerbs(all, synthesized.keywordMgmtFunctionId)).toStrictEqual({
      withoutCognitoAuthorizer: [],
      notIntegratedWithFunction: [],
    });
  });
});

describe('Lambda memory headroom (2.5.0 audit)', () => {
  /**
   * 14-day CloudWatch REPORT peaks on 2026-09-18: every function sat below
   * 60% of its memory except these two, which are raised here.
   */
  it('gives the health check the same 256 MB as the other API functions', () => {
    expect(synthesized.healthCheckMemorySize).toBe(256);
  });

  it('gives the dashboard bucket deployment handler 512 MB', () => {
    expect(synthesized.bucketDeploymentMemorySizes).toStrictEqual([512]);
  });
});

describe('Schedule routes (Schedules v2)', () => {
  /**
   * 2.3.0: schedules are addressed by their generated `sch-<hex>` id; the
   * definition is editable in place (PUT) and runnable on demand.
   */
  it('exposes GET and POST on the collection through the ConfigMgmt function', () => {
    const verbs = synthesized.schedulesMethods.map((method) => method.httpMethod).sort((a, b) => a.localeCompare(b));

    expect(verbs).toStrictEqual(['GET', 'POST']);
    expect(synthesized.schedulesMethods.every((method) => method.integrationUri.includes(synthesized.configMgmtFunctionId))).toBe(true);
  });

  it('exposes GET, PUT and DELETE on the schedule id resource', () => {
    const verbs = synthesized.scheduleIdMethods.map((method) => method.httpMethod).sort((a, b) => a.localeCompare(b));

    expect(verbs).toStrictEqual(['DELETE', 'GET', 'PUT']);
  });

  it('exposes POST only on the run sub-resource', () => {
    expect(synthesized.scheduleRunMethods.map((method) => method.httpMethod)).toStrictEqual(['POST']);
  });

  it('requires the Cognito authorizer on every schedule route', () => {
    const all = [...synthesized.schedulesMethods, ...synthesized.scheduleIdMethods, ...synthesized.scheduleRunMethods];

    expect(all).toHaveLength(6);
    expect(all.every((method) => method.authorizationType === COGNITO_AUTH)).toBe(true);
  });

  it('lets ConfigMgmt start workflow executions for run-now and read the groups table for scope checks', () => {
    expect(synthesized.configMgmtStateMachineActions).toContain('states:StartExecution');
    expect(synthesized.configMgmtEnvVars).toHaveProperty('DYNAMODB_TABLE_KEYWORD_GROUPS');
  });
});

describe('Report scope resolution (group KPIs)', () => {
  it('hands the keywords table to every function that resolves a report scope', () => {
    const missing = SCOPED_READ_FUNCTION_NAMES.filter(
      (name) => !('DYNAMODB_TABLE_KEYWORDS' in synthesized.scopedReadFunctionEnvVars[name])
    );

    expect(missing).toStrictEqual([]);
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
 * Keyword groups (2.1.0): folders of keywords, typically one per hotel.
 * Membership lives on the Keywords item as a string set, so the only new
 * table holds group metadata; every route runs through the KeywordMgmt
 * function and the shared Cognito authorizer.
 */
describe('Keyword groups', () => {
  it('creates the KeywordGroups table keyed by id only', () => {
    expect(synthesized.keywordGroupsTableKeySchema).toStrictEqual([
      { AttributeName: 'id', KeyType: 'HASH' },
    ]);
  });

  it('exposes GET and POST on the collection through the KeywordMgmt function', () => {
    const verbs = synthesized.keywordGroupsMethods.map((method) => method.httpMethod).sort((a, b) => a.localeCompare(b));

    expect(verbs).toStrictEqual(['GET', 'POST']);
    expect(synthesized.keywordGroupsMethods.every((method) => method.integrationUri.includes(synthesized.keywordMgmtFunctionId))).toBe(true);
  });

  it('exposes PUT and DELETE on the group id resource', () => {
    const verbs = synthesized.keywordGroupIdMethods.map((method) => method.httpMethod).sort((a, b) => a.localeCompare(b));

    expect(verbs).toStrictEqual(['DELETE', 'PUT']);
  });

  it('exposes PUT only on the membership sub-resource', () => {
    expect(synthesized.keywordGroupMembersMethods.map((method) => method.httpMethod)).toStrictEqual(['PUT']);
  });

  it('requires the Cognito authorizer on every keyword-group route', () => {
    const all = [
      ...synthesized.keywordGroupsMethods,
      ...synthesized.keywordGroupIdMethods,
      ...synthesized.keywordGroupMembersMethods,
    ];

    expect(all).toHaveLength(5);
    expect(all.every((method) => method.authorizationType === 'COGNITO_USER_POOLS')).toBe(true);
  });

  it('hands the groups table name to the functions that resolve scopes', () => {
    expect(synthesized.keywordMgmtEnvVars).toHaveProperty('DYNAMODB_TABLE_KEYWORD_GROUPS');
    expect(synthesized.executionMgmtEnvVars).toHaveProperty('DYNAMODB_TABLE_KEYWORD_GROUPS');
    expect(synthesized.parseKeywordsEnvVars).toHaveProperty('DYNAMODB_TABLE_KEYWORD_GROUPS');
  });
});

describe('Health check function', () => {
  it('attaches the shared layer it imports from', () => {
    /**
     * health.py imports shared.api_response; without the layer every monitor
     * received a 502 (Runtime.ImportModuleError). Pinned here so the layer
     * cannot be dropped again.
     */
    expect(synthesized.healthCheckLayerRefs).toHaveLength(1);
    expect(synthesized.healthCheckLayerRefs[0]).toMatch(/^SharedLayer/);
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
 * The twelve API functions now declare their groups the way the Step
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

  it('keeps every Step Functions worker at 30 days', () => {
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

describe('Crawler Lambda environment and cache permissions', () => {
  it('configures status-specific freshness and a short session backstop', () => {
    expect(synthesized.crawlerEnvVars.CRAWL_FRESHNESS_DAYS).toBe('30');
    expect(synthesized.crawlerEnvVars.CRAWL_BLOCKED_FRESHNESS_DAYS).toBe('3');
    expect(synthesized.crawlerEnvVars.BROWSER_SESSION_TIMEOUT_SECONDS).toBe('330');
    expect(synthesized.crawlerEnvVars.CRAWL_CACHE_INDEX_NAME).toBe('CacheScopeIndex');
  });

  it('projects only cache decision fields into the cache scope index', () => {
    expect(synthesized.crawledContentTableIndexes).toContainEqual({
      IndexName: 'CacheScopeIndex',
      KeySchema: [
        { AttributeName: 'cache_scope', KeyType: 'HASH' },
        { AttributeName: 'crawled_at', KeyType: 'RANGE' },
      ],
      Projection: {
        ProjectionType: 'INCLUDE',
        NonKeyAttributes: ['cache_status', 'analysis_status', 'block_reason'],
      },
    });
  });

  it('allows only cache queries, artifact writes, and metadata refreshes', () => {
    expect(synthesized.crawlerRoleCrawledContentActions).toStrictEqual([
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ]);
  });

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

describe('AgentCore crawler browser permissions', () => {
  it('binds BROWSER_ID to the pre-created custom browser', () => {
    expect(synthesized.crawlerBrowserLogicalId).not.toBe('');
    expect(synthesized.crawlerEnvVars.BROWSER_ID).toStrictEqual({
      'Fn::GetAtt': [synthesized.crawlerBrowserLogicalId, 'BrowserId'],
    });
  });

  it('grants exactly the required session actions on the custom browser ARN', () => {
    expect(synthesized.crawlerRoleBrowserStatements).toStrictEqual([{
      actions: [
        'bedrock-agentcore:ConnectBrowserAutomationStream',
        'bedrock-agentcore:StartBrowserSession',
        'bedrock-agentcore:StopBrowserSession',
      ],
      resources: [{
        'Fn::GetAtt': [synthesized.crawlerBrowserLogicalId, 'BrowserArn'],
      }],
    }]);
  });

  it('has no wildcard or legacy browser permissions', () => {
    const browserStatement = synthesized.crawlerRoleBrowserStatements[0];

    expect(browserStatement.actions).not.toContain('bedrock-agentcore:*');
    expect(browserStatement.actions).not.toContain('bedrock:GetAgent');
    expect(browserStatement.actions).not.toContain('bedrock:InvokeAgent');
    expect(browserStatement.resources).not.toContain('*');
  });
});

describe('AgentCore browser signing role', () => {
  it('has no broad identity policy when service trust provides signing access', () => {
    expect(synthesized.browserSigningRoleActions).toStrictEqual([]);
  });

  it('restricts service trust to browser resources in this account', () => {
    expect(synthesized.browserSigningTrustConditions).toStrictEqual({
      StringEquals: {
        'aws:SourceAccount': { Ref: 'AWS::AccountId' },
      },
      ArnLike: {
        'aws:SourceArn': {
          'Fn::Join': ['', [
            'arn:',
            { Ref: 'AWS::Partition' },
            ':bedrock-agentcore:',
            { Ref: 'AWS::Region' },
            ':',
            { Ref: 'AWS::AccountId' },
            ':*',
          ]],
        },
      },
    });
  });
});

describe('KPI alert backend infrastructure', () => {
  const app = new cdk.App();
  const template = Template.fromStack(new CitationAnalysisStack(app, 'KpiAlertTestStack'));

  const tableNames = [
    'CitationAnalysis-KpiSnapshots',
    'CitationAnalysis-KpiAlerts',
    'CitationAnalysis-AlertSettings',
    'CitationAnalysis-ContentChanges',
  ];

  it('creates the four tables with their exact key schemas', () => {
    const schemas = Object.fromEntries(
      tableNames.map((name) => [name, extractTableKeySchema(template, name)])
    );

    expect(schemas).toStrictEqual({
      'CitationAnalysis-KpiSnapshots': [
        { AttributeName: 'group_id', KeyType: 'HASH' },
        { AttributeName: 'snapshot_at', KeyType: 'RANGE' },
      ],
      'CitationAnalysis-KpiAlerts': [
        { AttributeName: 'id', KeyType: 'HASH' },
      ],
      'CitationAnalysis-AlertSettings': [
        { AttributeName: 'config_id', KeyType: 'HASH' },
      ],
      'CitationAnalysis-ContentChanges': [
        { AttributeName: 'group_id', KeyType: 'HASH' },
        { AttributeName: 'changed_at', KeyType: 'RANGE' },
      ],
    });
  });

  it('uses on-demand retained tables with point-in-time recovery', () => {
    const resources = tableNames.map((name) => {
      const matches = template.findResources('AWS::DynamoDB::Table', {
        Properties: { TableName: name },
      });
      return Object.values(matches)[0];
    });

    expect(resources.map((resource) => resolvePath(resource, ['Properties', 'BillingMode'])))
      .toStrictEqual(Array(4).fill('PAY_PER_REQUEST'));
    expect(resources.map((resource) => resolvePath(resource, ['Properties', 'PointInTimeRecoverySpecification', 'PointInTimeRecoveryEnabled'])))
      .toStrictEqual(Array(4).fill(true));
    expect(resources.map((resource) => resolvePath(resource, ['DeletionPolicy'])))
      .toStrictEqual(Array(4).fill(RETAIN));
  });

  it('expires snapshots alerts and content changes through ttl', () => {
    const ttlByTable = Object.fromEntries(
      tableNames.map((name) => [name, extractTableProperty(template, name, 'TimeToLiveSpecification')])
    );

    expect(ttlByTable).toStrictEqual({
      'CitationAnalysis-KpiSnapshots': { AttributeName: 'ttl', Enabled: true },
      'CitationAnalysis-KpiAlerts': { AttributeName: 'ttl', Enabled: true },
      'CitationAnalysis-AlertSettings': undefined,
      'CitationAnalysis-ContentChanges': { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('indexes alerts by status and creation time', () => {
    expect(extractTableProperty(template, 'CitationAnalysis-KpiAlerts', 'GlobalSecondaryIndexes'))
      .toStrictEqual([{
        IndexName: 'StatusCreatedIndex',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'created_at', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      }]);
  });

  it('creates one named SNS topic without static subscriptions', () => {
    const topics = template.findResources('AWS::SNS::Topic', {
      Properties: { TopicName: 'CitationAnalysis-KpiAlerts' },
    });

    expect(Object.keys(topics)).toHaveLength(1);
    expect(template.findResources('AWS::SNS::Subscription')).toStrictEqual({});
  });

  it('encrypts the topic with the request-priced AWS-managed SNS key', () => {
    const topics = template.findResources('AWS::SNS::Topic', {
      Properties: { TopicName: 'CitationAnalysis-KpiAlerts' },
    });
    const topic = Object.values(topics)[0];

    expect(JSON.stringify(resolvePath(topic, ['Properties', 'KmsMasterKeyId'])))
      .toContain('alias/aws/sns');
  });

  it('configures the KPI worker for Python with the shared layer and bounded runtime', () => {
    expect(extractFunctionTimeout(template, 'CitationAnalysis-KpiAlerts')).toBe(300);
    expect(extractFunctionMemorySize(template, 'CitationAnalysis-KpiAlerts')).toBe(512);
    expect(extractLambdaLayerRefs(template, 'CitationAnalysis-KpiAlerts')).toHaveLength(1);
  });

  it('hands every source and durable resource identifier to the KPI worker', () => {
    const environment = extractLambdaEnvVars(template, 'CitationAnalysis-KpiAlerts');

    expect(Object.keys(environment).sort((left, right) => left.localeCompare(right))).toStrictEqual([
      'DYNAMODB_TABLE_ALERT_SETTINGS',
      'DYNAMODB_TABLE_CONTENT_CHANGES',
      'DYNAMODB_TABLE_KEYWORD_GROUPS',
      'DYNAMODB_TABLE_KEYWORDS',
      'DYNAMODB_TABLE_KPI_ALERTS',
      'DYNAMODB_TABLE_KPI_SNAPSHOTS',
      'DYNAMODB_TABLE_PROVIDER_CONFIG',
      'DYNAMODB_TABLE_SEARCH_RESULTS',
      'KPI_ALERTS_TOPIC_ARN',
    ]);
  });

  it('grants the KPI worker publish only on the alert topic', () => {
    const topicId = findLogicalIdByName(
      template,
      'AWS::SNS::Topic',
      'TopicName',
      'CitationAnalysis-KpiAlerts'
    );

    expect(extractFunctionRoleActionsOn(template, 'CitationAnalysis-KpiAlerts', topicId))
      .toStrictEqual(['sns:Publish']);
  });

  it('grants the KPI worker read access to every source table', () => {
    const sourceTables = [
      'CitationAnalysis-SearchResults',
      'CitationAnalysis-Keywords',
      'CitationAnalysis-KeywordGroups',
      'CitationAnalysis-ProviderConfig',
      'CitationAnalysis-AlertSettings',
      'CitationAnalysis-ContentChanges',
    ];
    const missing = sourceTables.filter((tableName) => {
      const tableId = findLogicalIdByName(template, 'AWS::DynamoDB::Table', 'TableName', tableName);
      const actions = extractFunctionRoleActionsOn(template, 'CitationAnalysis-KpiAlerts', tableId);
      return !actions.includes('dynamodb:GetItem') || !actions.includes('dynamodb:Query');
    });

    expect(missing).toStrictEqual([]);
  });

  it('grants the KPI worker read-write snapshots and write-only alert records', () => {
    const snapshotsId = findLogicalIdByName(
      template, 'AWS::DynamoDB::Table', 'TableName', 'CitationAnalysis-KpiSnapshots'
    );
    const alertsId = findLogicalIdByName(
      template, 'AWS::DynamoDB::Table', 'TableName', 'CitationAnalysis-KpiAlerts'
    );
    const snapshotActions = extractFunctionRoleActionsOn(template, 'CitationAnalysis-KpiAlerts', snapshotsId);
    const alertActions = extractFunctionRoleActionsOn(template, 'CitationAnalysis-KpiAlerts', alertsId);

    expect(snapshotActions).toContain('dynamodb:GetItem');
    expect(snapshotActions).toContain('dynamodb:PutItem');
    expect(alertActions).toContain('dynamodb:PutItem');
    expect(alertActions).not.toContain('dynamodb:Query');
  });

  it('grants the KPI worker source reads and snapshot-alert writes', () => {
    const actions = extractFunctionRoleActions(template, 'CitationAnalysis-KpiAlerts');

    expect(actions).toContain('dynamodb:Query');
    expect(actions).toContain('dynamodb:Scan');
    expect(actions).toContain('dynamodb:PutItem');
    expect(actions).not.toContain('sns:Subscribe');
  });

  it('hands every alert resource identifier to ConfigMgmt', () => {
    const environment = extractLambdaEnvVars(template, CONFIG_MGMT_FUNCTION_NAME);

    expect(environment).toHaveProperty('DYNAMODB_TABLE_KPI_ALERTS');
    expect(environment).toHaveProperty('DYNAMODB_TABLE_ALERT_SETTINGS');
    expect(environment).toHaveProperty('DYNAMODB_TABLE_CONTENT_CHANGES');
    expect(environment).toHaveProperty('KPI_ALERTS_TOPIC_ARN');
  });

  it('grants ConfigMgmt read-write access to all alert API tables', () => {
    const tableNamesForApi = [
      'CitationAnalysis-KpiAlerts',
      'CitationAnalysis-AlertSettings',
      'CitationAnalysis-ContentChanges',
    ];
    const missing = tableNamesForApi.filter((tableName) => {
      const tableId = findLogicalIdByName(template, 'AWS::DynamoDB::Table', 'TableName', tableName);
      const actions = extractFunctionRoleActionsOn(template, CONFIG_MGMT_FUNCTION_NAME, tableId);
      return !actions.includes('dynamodb:GetItem') || !actions.includes('dynamodb:PutItem');
    });

    expect(missing).toStrictEqual([]);
  });

  it('grants ConfigMgmt only subscription management and publishing on this topic', () => {
    const topicId = findLogicalIdByName(
      template,
      'AWS::SNS::Topic',
      'TopicName',
      'CitationAnalysis-KpiAlerts'
    );

    expect(extractFunctionRoleActionsOn(template, CONFIG_MGMT_FUNCTION_NAME, topicId))
      .toStrictEqual([
        'sns:ListSubscriptionsByTopic',
        'sns:Publish',
        'sns:Subscribe',
        'sns:Unsubscribe',
      ]);
  });

  it('scopes the sole ConfigMgmt publish statement to the alert topic', () => {
    const topicId = findLogicalIdByName(
      template,
      'AWS::SNS::Topic',
      'TopicName',
      'CitationAnalysis-KpiAlerts'
    );
    const roleId = findFunctionRoleLogicalId(template, CONFIG_MGMT_FUNCTION_NAME);
    const publishResources = allowStatementsOfRole(template, roleId)
      .filter((statement) => statementActions(statement).includes('sns:Publish'))
      .map((statement) => resolvePath(statement, ['Resource']));

    expect(publishResources).toStrictEqual([{ Ref: topicId }]);
  });

  it('restricts unsubscribe to subscription ARNs under the alert topic', () => {
    const roleId = findFunctionRoleLogicalId(template, CONFIG_MGMT_FUNCTION_NAME);
    const unsubscribe = allowStatementsOfRole(template, roleId)
      .find((statement) => statementActions(statement).includes('sns:Unsubscribe'));
    const resource = JSON.stringify(resolvePath(unsubscribe, ['Resource']));

    expect(statementActions(unsubscribe)).toStrictEqual(['sns:Unsubscribe']);
    expect(resource).toContain(':*');
    expect(resource).not.toBe('"*"');
  });

  it('exposes the exact authenticated alert routes through ConfigMgmt', () => {
    const alertRoutes = extractApiAuthSnapshots(template)
      .filter((route) => route.path.startsWith('/api/alerts'))
      .sort((left, right) => `${left.path} ${left.httpMethod}`.localeCompare(`${right.path} ${right.httpMethod}`));

    expect(alertRoutes.map((route) => `${route.httpMethod} ${route.path}`)).toStrictEqual([
      'GET /api/alerts',
      'POST /api/alerts/{id}/acknowledge',
      'GET /api/alerts/content-changes',
      'POST /api/alerts/content-changes',
      'GET /api/alerts/settings',
      'PUT /api/alerts/settings',
      'POST /api/alerts/test-notification',
    ]);
    expect(alertRoutes.every((route) => route.authorizationType === COGNITO_AUTH)).toBe(true);
    expect(alertRoutes.every((route) => route.authorizerId !== '')).toBe(true);
  });

  it('integrates every alert route with the consolidated ConfigMgmt Lambda', () => {
    const alertsId = findApiResourceId(template, 'alerts');
    const alertId = findApiResourceId(template, '{id}', alertsId);
    const routeIds = [
      alertsId,
      findApiResourceId(template, 'acknowledge', alertId),
      findApiResourceId(template, 'settings', alertsId),
      findApiResourceId(template, 'test-notification', alertsId),
      findApiResourceId(template, 'content-changes', alertsId),
    ];
    const methods = routeIds.flatMap((resourceId) => extractApiMethods(template, resourceId));
    const configFunctionId = findLambdaLogicalId(template, CONFIG_MGMT_FUNCTION_NAME);

    expect(methods).toHaveLength(7);
    expect(methods.every((method) => method.integrationUri.includes(configFunctionId))).toBe(true);
  });

  it('passes execution id whole input and generated report to the alert task', () => {
    const definition = extractStateMachineDefinition(template, WORKFLOW_STATE_MACHINE);

    expect(definition).toContain('"execution_id.$":"$$.Execution.Name"');
    expect(definition).toContain('"execution_input.$":"$$.Execution.Input"');
    expect(definition).toContain('"report.$":"$"');
  });

  it('preserves the report and adds alerts on successful evaluation', () => {
    const definition = extractStateMachineDefinition(template, WORKFLOW_STATE_MACHINE);

    expect(definition).toContain('"Next":"KpiAlerts"');
    expect(definition).toContain('"ResultPath":"$.alerts"');
  });

  it('catches every alert failure and records a failure block', () => {
    const definition = extractStateMachineDefinition(template, WORKFLOW_STATE_MACHINE);

    expect(definition).toContain('"ErrorEquals":["States.ALL"]');
    expect(definition).toContain('"Catch":[{"ErrorEquals":["States.ALL"],"ResultPath":null,"Next":"KpiAlertsFailed"}]');
    expect(definition).toContain('"Next":"KpiAlertsFailed"');
    expect(definition).toContain('"message":"KPI alert evaluation failed; the analysis report is preserved."');
  });
});


describe('Citation Gaps gateway failure visibility', () => {
  const failureResponseTypes = new Set(['DEFAULT_5XX', 'INTEGRATION_TIMEOUT']);

  it('exposes default server failures and integration timeouts as HTTP responses when the stack is synthesized', () => {
    const failures = synthesized.gatewayResponses
      .filter((response) => failureResponseTypes.has(response.responseType))
      .map(({ responseType, statusCode }) => ({
        responseType,
        statusCode,
      }))
      .sort((left, right) => left.responseType.localeCompare(right.responseType));

    expect(failures).toStrictEqual([
      { responseType: 'DEFAULT_5XX', statusCode: '' },
      { responseType: 'INTEGRATION_TIMEOUT', statusCode: '504' },
    ]);
  });

  it('reuses restricted CORS headers when gateway failures bypass Lambda responses', () => {
    const restrictedHeaders = synthesized.gatewayResponses.find(
      (response) => response.responseType === 'UNAUTHORIZED'
    )?.responseParameters;
    const failureHeaders = synthesized.gatewayResponses
      .filter((response) => failureResponseTypes.has(response.responseType))
      .map((response) => response.responseParameters);

    expect(restrictedHeaders).toBeDefined();
    expect(failureHeaders).toStrictEqual([restrictedHeaders, restrictedHeaders]);
    expect(JSON.stringify(failureHeaders)).not.toContain("'*'");
  });

  it('keeps StatsInsights at 512 MB when measured memory remains below seventy percent', () => {
    expect(synthesized.statsInsightsMemorySize).toBe(512);
  });
});
