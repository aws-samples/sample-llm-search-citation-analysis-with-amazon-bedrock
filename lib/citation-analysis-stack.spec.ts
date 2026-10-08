import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  describe, it, expect, beforeAll
} from 'vitest';
import { CitationAnalysisStack } from './citation-analysis-stack';
import {
  EMPTY_BEDROCK_MODEL_PICKER_SNAPSHOT,
  EMPTY_CUSTOM_REPORTS_SNAPSHOT,
  EMPTY_PROVIDER_SEARCH_SNAPSHOT,
  EMPTY_WORKFLOW_SCALE_SNAPSHOT,
  SEARCH_PROVIDER_IDS,
  STATUS_CREATED_INDEX_SCHEMA,
  allProjectionIndexSchema,
  allowStatementsOfRole,
  allowStatementsOfTemplate,
  bedrockTierEnvironments,
  collectRefTargets,
  extractApiAuthSnapshots,
  extractApiBackedFunctionTimeouts,
  extractApiMethods,
  extractBedrockModelPickerSnapshot,
  extractBucketLifecycle,
  extractContentStudioInfrastructureSnapshot,
  extractContentSecurityPolicy,
  extractCrawlerInfrastructureSnapshot,
  extractCustomReportsSnapshot,
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
  extractProviderSearchSnapshot,
  extractReportInsightsSnapshot,
  extractReservedConcurrency,
  extractRoleTableActions,
  extractStateMachineDefinition,
  extractStateMachineLogging,
  extractTableKeySchema,
  extractTableProperty,
  extractUserPoolClientProps,
  extractUserPoolGroupNames,
  extractWafFootprint,
  extractWorkflowScaleSnapshot,
  findApiResourceId,
  findFunctionRoleLogicalId,
  findLambdaLogicalId,
  findLogicalIdByName,
  findModelAgreements,
  findStateMachineLogicalId,
  findUseCaseSubmission,
  keywordChildStates,
  methodRouteLabels,
  nonCanonicalTableEnvNames,
  providerSearchBranch,
  providerSearchBranchStarts,
  pythonResearchStaleAfterSeconds,
  pythonRoleDefaultTierEnv,
  pythonTierFoundationModelIds,
  regionalArnJoin,
  resolvePath,
  resolveString,
  retentionForLogGroupName,
  searchFunctionName,
  sortedHttpMethods,
  statementActions,
  tokenValidityMinutes,
  unguardedVerbs,
  useCaseToleratedErrorNames,
  COGNITO_AUTH,
  FULLY_GUARDED,
  type ApiGatewayMethodSnapshot,
  type ApiMethodAuthSnapshot,
  type BedrockModelPickerSnapshot,
  type BucketLifecycleSnapshot,
  type CrawlerInfrastructureSnapshot,
  type CustomReportsSnapshot,
  type LambdaLogGroupSnapshot,
  type ProviderSearchSnapshot,
  type StageMethodSettingSnapshot,
  type StateMachineLoggingSnapshot,
  type WafFootprint,
  type WorkflowScaleSnapshot,
} from './citation-analysis-stack-fixtures';

const KEYWORD_MGMT_FUNCTION_NAME = 'CitationAnalysis-API-KeywordMgmt';
const CONTENT_STUDIO_FUNCTION_NAME = 'CitationAnalysis-API-ContentStudio';
const CONTENT_STUDIO_WORKER_FUNCTION_NAME = 'CitationAnalysis-ContentStudioWorker';
const CONTENT_STUDIO_WORKER_CONCURRENCY = 10;

const PUBLIC_ROUTE = '/api/health';
const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const ONE_HOUR_IN_MINUTES = 60;
const SEVEN_DAYS_IN_MINUTES = 7 * 24 * 60;

const API_FUNCTION_PREFIX = 'CitationAnalysis-API-';
const SEARCH_ROLE_NAME = 'CitationAnalysis-SearchLambdaRole';
const PROVIDER_CONFIG_TABLE_NAME = 'CitationAnalysis-ProviderConfig';
const RETENTION_DAYS = 30;
const RETAIN = 'Retain';
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

const synthesized: CrawlerInfrastructureSnapshot & {
  definitionRaw: string;
  researchDefinitionRaw: string;
  researchStateMachineTimeoutSeconds: number;
  researchWorkerTimeoutSeconds: number;
  researchWorkerLayerRefs: string[];
  keywordResearchTableIndexes: unknown;
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
  citationsContentMemorySize: number;
  bucketDeploymentMemorySizes: number[];
  gatewayResponses: GatewayResponseSnapshot[];
  schedulesMethods: ApiGatewayMethodSnapshot[];
  scheduleIdMethods: ApiGatewayMethodSnapshot[];
  scheduleRunMethods: ApiGatewayMethodSnapshot[];
  configMgmtFunctionId: string;
  configMgmtEnvVars: Record<string, unknown>;
  configMgmtStateMachineActions: string[];
  scopedReadFunctionEnvVars: Record<string, Record<string, unknown>>;
  parseKeywordsEnvVars: Record<string, unknown>;
  nonCanonicalTableEnvNames: string[];
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
  contentStudioWorkerConcurrency: number | undefined;
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
  waf: WafFootprint;
  screenshotsLifecycle: BucketLifecycleSnapshot;
  accessLogsLifecycle: BucketLifecycleSnapshot;
  searchRoleProviderConfigActions: string[];
  sentimentExamplesMethods: ApiGatewayMethodSnapshot[];
  statsInsightsFunctionId: string;
  workflowScale: WorkflowScaleSnapshot;
  providerSearch: ProviderSearchSnapshot;
  customReports: CustomReportsSnapshot;
  bedrockModelPicker: BedrockModelPickerSnapshot;
  contentSecurityPolicy: Record<string, string[]>;
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
  citationsContentMemorySize: Number.NaN,
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
  nonCanonicalTableEnvNames: [],
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
  contentStudioWorkerConcurrency: undefined,
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
  waf: {
    resourceIds: [],
    distributionWebAclIds: [],
  },
  screenshotsLifecycle: { transitions: [], expirationDays: [] },
  accessLogsLifecycle: { transitions: [], expirationDays: [] },
  searchRoleProviderConfigActions: [],
  sentimentExamplesMethods: [],
  statsInsightsFunctionId: '',
  workflowScale: EMPTY_WORKFLOW_SCALE_SNAPSHOT,
  providerSearch: EMPTY_PROVIDER_SEARCH_SNAPSHOT,
  customReports: EMPTY_CUSTOM_REPORTS_SNAPSHOT,
  bedrockModelPicker: EMPTY_BEDROCK_MODEL_PICKER_SNAPSHOT,
  contentSecurityPolicy: {},
};

/**
 * Background workers with explicit bounded log groups. Listed so the API-side
 * fix cannot regress functions that were already correct.
 */
const WORKER_LOG_GROUP_NAMES = [
  '/aws/lambda/CitationAnalysis-ParseKeywords',
  ...SEARCH_PROVIDER_IDS.map((id) => `/aws/lambda/${searchFunctionName(id)}`),
  '/aws/lambda/CitationAnalysis-Deduplication',
  '/aws/lambda/CitationAnalysis-Crawler',
  '/aws/lambda/CitationAnalysis-GenerateSummary',
  '/aws/lambda/CitationAnalysis-KpiAlerts',
  '/aws/lambda/CitationAnalysis-ReportInsights',
  '/aws/lambda/CitationAnalysis-ResearchWorker',
  '/aws/lambda/CitationAnalysis-ContentStudioWorker',
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

/**
 * Lambdas that resolve a model through `shared.models` (e.g. for response
 * metadata) without holding `bedrock:InvokeModel`; every Claude caller is
 * found from its role.
 */
const SHARED_MODELS_CALLERS_WITHOUT_INVOKE = ['CitationAnalysis-API-ContentStudio'];

/** Every Lambda that calls `shared.models` (Settings › Bedrock models, 2.36.0). */
const SAVED_BEDROCK_MODEL_CALLERS = [
  ...SEARCH_PROVIDER_IDS.map(searchFunctionName),
  'CitationAnalysis-Crawler',
  'CitationAnalysis-ReportInsights',
  'CitationAnalysis-ResearchWorker',
  'CitationAnalysis-API-StatsInsights',
  'CitationAnalysis-API-ManageBrandConfig',
  'CitationAnalysis-API-SelfReflection',
  'CitationAnalysis-API-ContentStudio',
  'CitationAnalysis-ContentStudioWorker',
  'CitationAnalysis-API-ConfigMgmt',
].sort((left, right) => left.localeCompare(right));

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
  synthesized.nonCanonicalTableEnvNames = nonCanonicalTableEnvNames(template);
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
  synthesized.citationsContentMemorySize = extractFunctionMemorySize(template, 'CitationAnalysis-API-CitationsContent');
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
    .filter((tableName) => tableName.includes('GroupBrief'));
  synthesized.contentStudioConcurrency =
    extractReservedConcurrency(template, CONTENT_STUDIO_FUNCTION_NAME);
  synthesized.contentStudioWorkerConcurrency =
    extractReservedConcurrency(template, CONTENT_STUDIO_WORKER_FUNCTION_NAME);
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

  synthesized.waf = extractWafFootprint(template);

  synthesized.screenshotsLifecycle = extractBucketLifecycle(template, SCREENSHOTS_BUCKET_PREFIX);
  synthesized.accessLogsLifecycle = extractBucketLifecycle(template, ACCESS_LOGS_BUCKET_PREFIX);

  synthesized.searchRoleProviderConfigActions =
    extractRoleTableActions(template, SEARCH_ROLE_NAME, PROVIDER_CONFIG_TABLE_NAME);

  const visibilityId = findApiResourceId(template, 'visibility');
  synthesized.sentimentExamplesMethods = extractApiMethods(
    template, findApiResourceId(template, 'sentiment-examples', visibilityId)
  );
  synthesized.statsInsightsFunctionId = findLambdaLogicalId(template, 'CitationAnalysis-API-StatsInsights');
  synthesized.workflowScale = extractWorkflowScaleSnapshot(template);
  synthesized.providerSearch = extractProviderSearchSnapshot(template);
  synthesized.customReports = extractCustomReportsSnapshot(template);
  synthesized.bedrockModelPicker = extractBedrockModelPickerSnapshot(template, SHARED_MODELS_CALLERS_WITHOUT_INVOKE);
  synthesized.contentSecurityPolicy = extractContentSecurityPolicy(template);
}, 180_000);

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

  it('still has the documented exception wired to the API', () => {
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

  it('caps the Content Studio API now that generation runs in its worker', () => {
    expect(synthesized.apiBackedFunctionTimeouts[CONTENT_STUDIO_FUNCTION_NAME]).toBe(GATEWAY_CEILING);
  });
});

describe('Content Studio group brief infrastructure', () => {
  it('points the group environment variable at the existing KeywordGroups table', () => {
    expect(synthesized.contentStudioKeywordGroupsEnvRef).toBe(
      synthesized.contentStudioKeywordGroupsTableId
    );
  });

  it('grants Content Studio exact group lookup access', () => {
    expect(synthesized.contentStudioKeywordGroupsActions).toStrictEqual([
      'dynamodb:GetItem',
    ]);
  });

  it('adds no dedicated group brief table', () => {
    expect(synthesized.groupBriefTableNames).toStrictEqual([]);
  });
});

describe('Content Studio API and worker concurrency separation', () => {
  it('reserves no concurrency for the Content Studio API, which no longer generates', () => {
    expect(synthesized.contentStudioConcurrency).toBeUndefined();
  });

  it('caps the durable generation worker at ten concurrent model calls', () => {
    expect(synthesized.contentStudioWorkerConcurrency).toBe(CONTENT_STUDIO_WORKER_CONCURRENCY);
  });

  it('no longer reserves concurrency for Keyword Management, which stopped self-invoking', () => {
    expect(synthesized.keywordMgmtConcurrency).toBeUndefined();
  });

  it('keeps the worker cap small enough to bound model spend', () => {
    expect(synthesized.contentStudioWorkerConcurrency).toBeLessThanOrEqual(50);
  });
});

describe('Stack outputs do not claim protection that is not configured', () => {
  it.each(['WafWebAclArn', 'CloudFrontWafWebAclArn'])('exports no %s output', (outputKey) => {
    expect(synthesized.outputKeys).not.toContain(outputKey);
  });
});

/**
 * No WAF, by decision: the sample stays pay-per-use, and a web ACL bills every
 * month whether or not the demo is used. The Cognito authorizer, the stage
 * throttle and the usage plan protect the API; see the comment in the stack.
 */
describe('WAF', () => {
  it('defines no WAFv2 resource and no CloudFront web ACL custom resource', () => {
    expect(synthesized.waf.resourceIds).toStrictEqual([]);
  });

  it('attaches no web ACL to the CloudFront distribution', () => {
    expect(synthesized.waf.distributionWebAclIds).toStrictEqual([]);
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
    const openRoutes = methodRouteLabels(synthesized.apiAuthSnapshots
      .filter((method) => method.authorizationType !== COGNITO_AUTH));

    expect(openRoutes).toStrictEqual([`GET ${PUBLIC_ROUTE}`]);
  });

  it('requires the Cognito authorizer on every other route', () => {
    const unauthorized = methodRouteLabels(synthesized.apiAuthSnapshots
      .filter((method) => method.path !== PUBLIC_ROUTE && method.authorizerId === ''));

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
    const openMutations = methodRouteLabels(synthesized.apiAuthSnapshots
      .filter((method) => MUTATING_METHODS.includes(method.httpMethod))
      .filter((method) => method.authorizationType !== COGNITO_AUTH));

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

/**
 * Keyword scale (2.27.0). ProcessKeywords was an inline Map: every keyword's
 * ~8.5 KB result landed in the 256 KiB state (runs over ~31 keywords failed
 * with States.DataLimitExceeded after all the spend) and ~160 history events
 * per keyword counted against the 25,000-event cap. It is now a Distributed
 * Map whose items and results live in S3, so the parent's state and history
 * stay flat in the keyword count.
 */
describe('Keyword-scale analysis workflow', () => {
  const PROCESS_KEYWORDS = ['States', 'ProcessKeywords'];
  const CHILD_STATES = [...PROCESS_KEYWORDS, 'ItemProcessor', 'States'];

  it('runs ProcessKeywords as a distributed map of standard child executions', () => {
    expect(resolvePath(synthesized.workflowScale.definition, [...PROCESS_KEYWORDS, 'ItemProcessor', 'ProcessorConfig']))
      .toStrictEqual({ Mode: 'DISTRIBUTED', ExecutionType: 'STANDARD' });
  });

  it('reads the ProcessKeywords items from the manifest ParseKeywords names', () => {
    expect(resolvePath(synthesized.workflowScale.definition, [...PROCESS_KEYWORDS, 'ItemReader'])).toStrictEqual({
      Resource: 'arn:__TOKEN__:states:::s3:getObject',
      ReaderConfig: { InputType: 'JSON' },
      Parameters: { Bucket: '__TOKEN__', 'Key.$': '$.keywords_manifest.key' },
    });
  });

  it('writes the ProcessKeywords results under the run-scratch prefix', () => {
    expect(resolvePath(synthesized.workflowScale.definition, [...PROCESS_KEYWORDS, 'ResultWriter', 'Parameters']))
      .toStrictEqual({ Bucket: '__TOKEN__', Prefix: 'runs/map-results' });
  });

  it('keeps the ParseKeywords output and adds the map run pointer as map_run', () => {
    expect(resolvePath(synthesized.workflowScale.definition, [...PROCESS_KEYWORDS, 'ResultPath'])).toBe('$.map_run');
  });

  it('tolerates up to 10 percent failed keywords before failing the run', () => {
    expect(resolvePath(synthesized.workflowScale.definition, [...PROCESS_KEYWORDS, 'ToleratedFailurePercentage'])).toBe(10);
  });

  it('runs 20 keywords at a time by default', () => {
    expect(resolvePath(synthesized.workflowScale.definition, [...PROCESS_KEYWORDS, 'MaxConcurrency'])).toBe(20);
  });

  it('ends each keyword child with a compact result that keeps counts instead of the citation and crawl arrays', () => {
    expect(resolvePath(synthesized.workflowScale.definition, [...CHILD_STATES, 'SummarizeKeywordResult'])).toStrictEqual({
      Type: 'Pass',
      Parameters: {
        'keyword.$': '$.keyword',
        'timestamp.$': '$.timestamp',
        'status.$': '$.status',
        'provider_summary.$': '$.provider_summary',
        'unique_citations.$': 'States.ArrayLength($.deduplicated_citations)',
        'total_citations_found.$': '$.total_citations_found',
        'pages_crawled.$': "States.ArrayLength($.crawled_results[?(@.status == 'success')])",
      },
      End: true,
    });
  });

  it('hands ParseKeywords the execution input and the execution name', () => {
    expect(resolvePath(synthesized.workflowScale.definition, ['States', 'ParseKeywords', 'Parameters', 'Payload']))
      .toStrictEqual({ 'execution_input.$': '$', 'execution_name.$': '$$.Execution.Name' });
  });

  it('hands GenerateSummary the map run pointer instead of the keyword results', () => {
    expect(resolvePath(synthesized.workflowScale.definition, ['States', 'GenerateSummary', 'Parameters', 'Payload'])).toStrictEqual({
      'execution_id.$': '$$.Execution.Name',
      'map_run.$': '$.map_run',
      'keyword_count.$': '$.keyword_count',
      'timestamp.$': '$.timestamp',
      summary_bucket: '__TOKEN__',
    });
  });

  it('allows the workflow seven days', () => {
    expect(extractDefinitionTimeoutSeconds(synthesized.definitionRaw)).toBe(SEVEN_DAYS_IN_MINUTES * 60);
  });

  it('sizes GenerateSummary for thousands of keyword results', () => {
    expect([synthesized.workflowScale.generateSummaryMemorySize, synthesized.workflowScale.generateSummaryTimeoutSeconds])
      .toStrictEqual([1024, 300]);
  });
});

describe('Keywords bucket run-scratch lifecycle', () => {
  it('expires runs/ objects and abandoned uploads under runs/ only', () => {
    expect(synthesized.workflowScale.keywordsBucketRules).toStrictEqual([{
      Id: 'ExpireRunScratch',
      Status: 'Enabled',
      Prefix: 'runs/',
      ExpirationInDays: 30,
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    }]);
  });
});

describe('Keyword-scale workflow permissions', () => {
  it('lets the workflow role describe and stop its distributed map child executions', () => {
    expect(synthesized.workflowScale.childExecutionDescribeResources)
      .toContain(':execution:CitationAnalysis-Workflow/*');
  });

  it('lets the execution status endpoint describe the workflow map runs', () => {
    expect(synthesized.workflowScale.describeMapRunResources).toContain(':mapRun:CitationAnalysis-Workflow/*');
  });

  it('lets the execution status endpoint list the map runs of workflow executions', () => {
    expect(synthesized.workflowScale.listMapRunsResources).toContain(':execution:CitationAnalysis-Workflow:*');
  });

  it('lets ParseKeywords write only under runs/', () => {
    expect(synthesized.workflowScale.parseKeywordsPutResources).toMatch(/^\[\{"Fn::Join":\["",\[\{"Fn::GetAtt":\["KeywordsBucket\w+","Arn"\]\},"\/runs\/\*"\]\]\}\]$/);
  });

  it('lets GenerateSummary read the map run results under runs/', () => {
    expect(synthesized.workflowScale.generateSummaryReadResources).toContain('"/runs/*"');
  });

  it('lets KpiAlerts read the stored execution summaries', () => {
    expect(synthesized.workflowScale.kpiAlertsReadResources).toContain('"/execution-summaries/*"');
  });
});

/**
 * Parallel providers (2.28.0). Every provider used to be called one after
 * another inside one search Lambda (~139 s per keyword), with nothing bounding
 * how many keywords hit a provider at once. Each provider now has its own
 * function whose reserved concurrency caps its calls in flight across the run.
 */
const DEFAULT_PROVIDER_CAPS: Record<string, number | undefined> = {
  openai: 10,
  perplexity: 3,
  gemini: 10,
  claude: 5,
  brave: 10,
  tavily: 10,
  exa: 5,
  serpapi: 5,
  firecrawl: 2,
};
const LAMBDA_SERVICE_ERRORS = [
  'Lambda.ClientExecutionTimeoutException',
  'Lambda.ServiceException',
  'Lambda.AWSLambdaException',
  'Lambda.SdkClientException',
];

describe('Per-provider search functions', () => {
  it('caps each provider with its default reserved concurrency', () => {
    expect(synthesized.providerSearch.reservedConcurrency).toStrictEqual(DEFAULT_PROVIDER_CAPS);
  });

  it('gives every provider function the 15-minute search timeout', () => {
    expect(synthesized.providerSearch.timeoutSeconds)
      .toStrictEqual(Object.fromEntries(SEARCH_PROVIDER_IDS.map((id) => [id, 900])));
  });

  it('runs every provider function as the shared search role', () => {
    expect(synthesized.providerSearch.searchRoleLogicalId).not.toBe('');
    expect(new Set(Object.values(synthesized.providerSearch.roleLogicalIds)))
      .toStrictEqual(new Set([synthesized.providerSearch.searchRoleLogicalId]));
  });

  it('sets 12 extra throttle attempts on the provider functions and no other function', () => {
    expect(synthesized.providerSearch.throttleExtraAttemptsByFunction)
      .toStrictEqual(Object.fromEntries(SEARCH_PROVIDER_IDS.map((id) => [searchFunctionName(id), '12'])));
  });

  it('removes the single CitationAnalysis-Search function', () => {
    expect(synthesized.providerSearch.legacyFunctionLogicalId).toBe('');
  });

  it('keeps the single search function log group so earlier runs stay readable', () => {
    expect(synthesized.providerSearch.legacyLogGroupLogicalId).toBe('SearchLogGroup64E61B0B');
  });

  it('drops the SearchFunctionArn output with the function it named', () => {
    expect(synthesized.outputKeys).not.toContain('SearchFunctionArn');
  });
});

describe('SearchAllProviders parallel search', () => {
  const childStates = (): unknown => keywordChildStates(synthesized.workflowScale.definition);
  const branchState = (providerId: string, stateName: string): unknown =>
    resolvePath(providerSearchBranch(synthesized.workflowScale.definition, providerId), ['States', stateName]);
  const searchTask = (providerId: string): unknown => branchState(providerId, `Search-${providerId}`);

  it('fans out to one branch per provider', () => {
    expect(providerSearchBranchStarts(synthesized.workflowScale.definition))
      .toStrictEqual(SEARCH_PROVIDER_IDS.map((id) => `Search-${id}`));
  });

  it('keeps the branch outputs at provider_results and goes on to MergeProviderResults', () => {
    const parallel = resolvePath(childStates(), ['SearchAllProviders']);

    expect([resolvePath(parallel, ['Type']), resolvePath(parallel, ['ResultPath']), resolvePath(parallel, ['Next'])])
      .toStrictEqual(['Parallel', '$.provider_results', 'MergeProviderResults']);
  });

  it('sends each branch the keyword, timestamp, query prompts and only its own provider', () => {
    expect(SEARCH_PROVIDER_IDS.map((id) => resolvePath(searchTask(id), ['Parameters', 'Payload'])))
      .toStrictEqual(SEARCH_PROVIDER_IDS.map((id) => ({
        'keyword.$': '$.keyword',
        'timestamp.$': '$.timestamp',
        'query_prompts.$': '$.query_prompts',
        providers: [id],
      })));
  });

  it('keeps only the slim results of each provider Lambda', () => {
    expect(new Set(SEARCH_PROVIDER_IDS.map((id) => JSON.stringify(resolvePath(searchTask(id), ['ResultSelector'])))))
      .toStrictEqual(new Set([JSON.stringify({ 'results.$': '$.Payload.results' })]));
  });

  it('checks the slot retrier before States.TaskFailed, which also matches a throttled invoke', () => {
    const retriers = resolvePath(searchTask('perplexity'), ['Retry']);

    expect((Array.isArray(retriers) ? retriers : []).map((retrier) => resolvePath(retrier, ['ErrorEquals'])))
      .toStrictEqual([LAMBDA_SERVICE_ERRORS, ['Lambda.TooManyRequestsException'], ['States.TaskFailed', 'States.Timeout']]);
  });

  it('waits for a free slot with jittered backoff while a provider is at its cap', () => {
    expect(resolvePath(searchTask('perplexity'), ['Retry', '1'])).toStrictEqual({
      ErrorEquals: ['Lambda.TooManyRequestsException'],
      IntervalSeconds: 2,
      MaxAttempts: 120,
      BackoffRate: 1.5,
      MaxDelaySeconds: 30,
      JitterStrategy: 'FULL',
    });
  });

  it('retries a failed provider Lambda twice with backoff', () => {
    expect(resolvePath(searchTask('openai'), ['Retry', '2'])).toStrictEqual({
      ErrorEquals: ['States.TaskFailed', 'States.Timeout'],
      IntervalSeconds: 10,
      MaxAttempts: 2,
      BackoffRate: 2,
    });
  });

  it('catches every provider failure into that provider\'s failed state', () => {
    expect(SEARCH_PROVIDER_IDS.map((id) => resolvePath(searchTask(id), ['Catch'])))
      .toStrictEqual(SEARCH_PROVIDER_IDS.map((id) => [{ ErrorEquals: ['States.ALL'], Next: `SearchFailed-${id}` }]));
  });

  it('records a failed search provider as one error row of type search', () => {
    expect(branchState('serpapi', 'SearchFailed-serpapi')).toStrictEqual({
      Type: 'Pass',
      Result: {
        results: [{
          provider: 'serpapi',
          provider_type: 'search',
          status: 'error',
          error: 'provider Lambda failed',
          citations: [],
          citation_count: 0,
          query_prompt_id: 'default',
        }],
      },
      End: true,
    });
  });

  it('records a failed answer engine as an error row of type llm', () => {
    expect(resolvePath(branchState('claude', 'SearchFailed-claude'), ['Result', 'results', '0', 'provider_type']))
      .toBe('llm');
  });

  it('flattens the branch results into the input DeduplicateCitations reads', () => {
    expect(resolvePath(childStates(), ['MergeProviderResults'])).toStrictEqual({
      Type: 'Pass',
      Parameters: {
        'keyword.$': '$.keyword',
        'timestamp.$': '$.timestamp',
        'results.$': '$.provider_results[*].results[*]',
      },
      Next: 'DeduplicateCitations',
    });
  });

  it('crawls 10 citations at a time per keyword by default', () => {
    expect(resolvePath(childStates(), ['CrawlCitations', 'MaxConcurrency'])).toBe(10);
  });
});

describe('Search and crawl concurrency overrides', () => {
  const app = new cdk.App({
    context: {
      providerConcurrency: '{"perplexity":5,"firecrawl":0}',
      crawlConcurrency: '4',
      processKeywordsConcurrency: '7',
    },
  });
  const template = Template.fromStack(new CitationAnalysisStack(app, 'ConcurrencyOverrideStack'));
  const providerSearch = extractProviderSearchSnapshot(template);
  const definition = extractWorkflowScaleSnapshot(template).definition;

  it('applies -c providerConcurrency caps and keeps the defaults of providers it does not name', () => {
    expect(providerSearch.reservedConcurrency).toStrictEqual({ ...DEFAULT_PROVIDER_CAPS, perplexity: 5, firecrawl: undefined });
  });

  it('runs -c crawlConcurrency citations at a time per keyword', () => {
    expect(resolvePath(keywordChildStates(definition), ['CrawlCitations', 'MaxConcurrency'])).toBe(4);
  });

  it('runs -c processKeywordsConcurrency keywords at a time', () => {
    expect(resolvePath(definition, ['States', 'ProcessKeywords', 'MaxConcurrency'])).toBe(7);
  });
});

describe('Invalid -c providerConcurrency', () => {
  it.each([
    ['names an unknown provider', '{"bing":2}', "unknown provider 'bing' (known: openai, perplexity, gemini, claude, brave, tavily, exa, serpapi, firecrawl)"],
    ['sets a negative cap', { perplexity: -1 }, "'perplexity' must be a positive integer, or 0 for no cap, got -1"],
    ['sets a fractional cap', '{"openai":2.5}', "'openai' must be a positive integer, or 0 for no cap, got 2.5"],
    ['sets a cap as a string', { exa: '5' }, "'exa' must be a positive integer, or 0 for no cap, got \"5\""],
    ['is not JSON', 'perplexity=5', 'must be a JSON object, got perplexity=5'],
    ['is a JSON array', '[5]', 'must be a JSON object, got "[5]"'],
  ])('fails synth when the value %s', (_case, providerConcurrency, message) => {
    const app = new cdk.App({ context: { providerConcurrency } });

    expect(() => new CitationAnalysisStack(app, 'InvalidProviderConcurrencyStack'))
      .toThrow(`CDK context 'providerConcurrency': ${message}`);
  });
});

describe('Keyword research state machine', () => {
  /**
   * 2.2.0: keyword research left the API Lambda's self-invoke path for a
   * dedicated state machine. One execution per job, one parallel step per
   * web-search provider, every step checkpointed into the job row.
   */
  const SWEEP_THRESHOLD_SECONDS = pythonResearchStaleAfterSeconds();

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
     * `shared/research_jobs.RESEARCH_STALE_AFTER_SECONDS` (read from the
     * Python source) marks jobs failed after 35 minutes. An execution allowed
     * to outlive that could finish after being failed and flip the row back —
     * the inversion the sweep exists to avoid.
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
    expect(synthesized.keywordResearchTableIndexes).toStrictEqual([
      allProjectionIndexSchema('TypeCreatedIndex', 'type', 'created_at'),
    ]);
  });

  it('expires rows through the ttl attribute the job writer sets', () => {
    expect(synthesized.keywordResearchTableTtl).toStrictEqual({ AttributeName: 'ttl', Enabled: true });
  });
});

describe('Keyword research routes', () => {
  it('exposes GET and DELETE on the job id resource', () => {
    expect(sortedHttpMethods(synthesized.keywordResearchIdMethods)).toStrictEqual(['DELETE', 'GET']);
  });

  it('exposes POST only on the retry sub-resource', () => {
    expect(sortedHttpMethods(synthesized.keywordResearchRetryMethods)).toStrictEqual(['POST']);
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
    expect(sortedHttpMethods(synthesized.keywordResearchAgentMethods)).toStrictEqual(['POST']);
  });

  it('exposes GET and POST on the templates collection and PUT and DELETE on a template', () => {
    expect(sortedHttpMethods(synthesized.researchTemplatesMethods)).toStrictEqual(['GET', 'POST']);
    expect(sortedHttpMethods(synthesized.researchTemplateIdMethods)).toStrictEqual(['DELETE', 'PUT']);
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

  /**
   * 7-day CloudWatch REPORT peaks on 2026-09-21: CitationsContent reached
   * 153 MB (60% of 256 MB), the highest ratio of any function.
   */
  it('gives CitationsContent 512 MB after its peak reached 60% of the previous 256 MB', () => {
    expect(synthesized.citationsContentMemorySize).toBe(512);
  });
});

describe('Schedule routes (Schedules v2)', () => {
  /**
   * 2.3.0: schedules are addressed by their generated `sch-<hex>` id; the
   * definition is editable in place (PUT) and runnable on demand.
   */
  it('exposes GET and POST on the collection through the ConfigMgmt function', () => {
    expect(sortedHttpMethods(synthesized.schedulesMethods)).toStrictEqual(['GET', 'POST']);
    expect(synthesized.schedulesMethods.every((method) => method.integrationUri.includes(synthesized.configMgmtFunctionId))).toBe(true);
  });

  it('exposes GET, PUT and DELETE on the schedule id resource', () => {
    expect(sortedHttpMethods(synthesized.scheduleIdMethods)).toStrictEqual(['DELETE', 'GET', 'PUT']);
  });

  it('exposes POST only on the run sub-resource', () => {
    expect(sortedHttpMethods(synthesized.scheduleRunMethods)).toStrictEqual(['POST']);
  });

  it('lets ConfigMgmt start workflow executions for run-now and read the groups table for scope checks', () => {
    expect(synthesized.configMgmtStateMachineActions).toContain('states:StartExecution');
    expect(synthesized.configMgmtEnvVars).toHaveProperty('DYNAMODB_TABLE_KEYWORD_GROUPS');
  });
});

describe('Sentiment examples route', () => {
  it('exposes GET only on /api/visibility/sentiment-examples', () => {
    expect(sortedHttpMethods(synthesized.sentimentExamplesMethods)).toStrictEqual(['GET']);
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

describe('Lambda table environment names', () => {
  it('names every table through a DYNAMODB_TABLE_ variable on every function', () => {
    expect(synthesized.nonCanonicalTableEnvNames).toStrictEqual([]);
  });
});

describe('ParseKeywords Lambda environment', () => {
  it('includes the query prompts table for execution-time prompt resolution', () => {
    expect(synthesized.parseKeywordsEnvVars).toHaveProperty('DYNAMODB_TABLE_QUERY_PROMPTS');
  });

  it('names the keywords bucket the run manifest is written to', () => {
    expect(collectRefTargets(synthesized.parseKeywordsEnvVars.KEYWORDS_BUCKET)[0]).toMatch(/^KeywordsBucket/);
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
    expect(synthesized.promoteMethods[0]?.authorizationType).toBe(COGNITO_AUTH);
    expect(synthesized.promoteMethods[0]?.authorizerId).not.toBe('');
  });

  it('keeps PUT and DELETE on the sibling keyword id resource', () => {
    const idVerbs = sortedHttpMethods(synthesized.keywordIdMethods);

    expect(idVerbs).toStrictEqual(['DELETE', 'PUT']);
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
    expect(sortedHttpMethods(synthesized.keywordGroupsMethods)).toStrictEqual(['GET', 'POST']);
    expect(synthesized.keywordGroupsMethods.every((method) => method.integrationUri.includes(synthesized.keywordMgmtFunctionId))).toBe(true);
  });

  it('exposes PUT and DELETE on the group id resource', () => {
    expect(sortedHttpMethods(synthesized.keywordGroupIdMethods)).toStrictEqual(['DELETE', 'PUT']);
  });

  it('exposes PUT only on the membership sub-resource', () => {
    expect(sortedHttpMethods(synthesized.keywordGroupMembersMethods)).toStrictEqual(['PUT']);
  });

  it('hands the groups table name to the functions that resolve scopes', () => {
    expect(synthesized.keywordMgmtEnvVars).toHaveProperty('DYNAMODB_TABLE_KEYWORD_GROUPS');
    expect(synthesized.executionMgmtEnvVars).toHaveProperty('DYNAMODB_TABLE_KEYWORD_GROUPS');
    expect(synthesized.parseKeywordsEnvVars).toHaveProperty('DYNAMODB_TABLE_KEYWORD_GROUPS');
  });
});

/**
 * Saved custom reports: one table keyed by id, served by the ConfigMgmt
 * function. Every signed-in user may read and write them, so the only gate is
 * the shared Cognito authorizer.
 */
describe('Custom reports', () => {
  it('creates the CustomReports table keyed by id only', () => {
    expect(synthesized.customReports.table.keySchema).toStrictEqual([
      { AttributeName: 'id', KeyType: 'HASH' },
    ]);
  });

  it('uses an on-demand, encrypted, retained table with point-in-time recovery', () => {
    const { table } = synthesized.customReports;

    expect({
      billingMode: table.billingMode,
      pointInTimeRecovery: table.pointInTimeRecovery,
      encryption: table.encryption,
      deletionPolicy: table.deletionPolicy,
    }).toStrictEqual({
      billingMode: 'PAY_PER_REQUEST',
      pointInTimeRecovery: true,
      encryption: { SSEEnabled: true },
      deletionPolicy: RETAIN,
    });
  });

  it('hands the table name to ConfigMgmt', () => {
    expect(synthesized.customReports.configMgmtTableEnv).toStrictEqual({ Ref: synthesized.customReports.tableLogicalId });
  });

  it('grants ConfigMgmt the reads and writes the CRUD routes make', () => {
    expect(synthesized.customReports.configMgmtTableActions).toStrictEqual(expect.arrayContaining([
      'dynamodb:DeleteItem',
      'dynamodb:PutItem',
      'dynamodb:Scan',
      'dynamodb:UpdateItem',
    ]));
  });

  it('exposes GET and POST on the collection and PUT and DELETE on a report', () => {
    expect(sortedHttpMethods(synthesized.customReports.collectionMethods)).toStrictEqual(['GET', 'POST']);
    expect(sortedHttpMethods(synthesized.customReports.itemMethods)).toStrictEqual(['DELETE', 'PUT']);
  });
});

describe('Cognito-guarded route families', () => {
  it.each([
    {
      family: 'keyword research job',
      routes: () => [...synthesized.keywordResearchIdMethods, ...synthesized.keywordResearchRetryMethods],
      verbCount: 3,
      functionId: () => synthesized.keywordMgmtFunctionId,
    },
    {
      family: 'research agent',
      routes: () => [
        ...synthesized.keywordResearchAgentMethods,
        ...synthesized.researchTemplatesMethods,
        ...synthesized.researchTemplateIdMethods,
      ],
      verbCount: 5,
      functionId: () => synthesized.keywordMgmtFunctionId,
    },
    {
      family: 'schedule',
      routes: () => [...synthesized.schedulesMethods, ...synthesized.scheduleIdMethods, ...synthesized.scheduleRunMethods],
      verbCount: 6,
      functionId: () => synthesized.configMgmtFunctionId,
    },
    {
      family: 'keyword-group',
      routes: () => [
        ...synthesized.keywordGroupsMethods,
        ...synthesized.keywordGroupIdMethods,
        ...synthesized.keywordGroupMembersMethods,
      ],
      verbCount: 5,
      functionId: () => synthesized.keywordMgmtFunctionId,
    },
    {
      family: 'custom report',
      routes: () => [...synthesized.customReports.collectionMethods, ...synthesized.customReports.itemMethods],
      verbCount: 4,
      functionId: () => synthesized.customReports.configMgmtFunctionLogicalId,
    },
    {
      family: 'sentiment examples',
      routes: () => synthesized.sentimentExamplesMethods,
      verbCount: 1,
      functionId: () => synthesized.statsInsightsFunctionId,
    },
  ])('puts every $family verb behind the Cognito authorizer on its API function', ({ routes, verbCount, functionId }) => {
    expect(routes()).toHaveLength(verbCount);
    expect(unguardedVerbs(routes(), functionId())).toStrictEqual(FULLY_GUARDED);
  });
});

describe('Dashboard content security policy', () => {
  it('allows frames only from the privacy-enhanced YouTube player and the Vimeo player', () => {
    expect(synthesized.contentSecurityPolicy['frame-src']).toStrictEqual([
      'https://www.youtube-nocookie.com',
      'https://player.vimeo.com',
    ]);
  });

  it('still forbids every site from framing the dashboard', () => {
    expect(synthesized.contentSecurityPolicy['frame-ancestors']).toStrictEqual(["'none'"]);
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

  it('keeps every background worker at 30 days', () => {
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
        'aws:SourceArn': regionalArnJoin('bedrock-agentcore', '*'),
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
  const alertTopics = template.findResources('AWS::SNS::Topic', {
    Properties: { TopicName: 'CitationAnalysis-KpiAlerts' },
  });
  const alertTopicId = findLogicalIdByName(template, 'AWS::SNS::Topic', 'TopicName', 'CitationAnalysis-KpiAlerts');

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
      .toStrictEqual([STATUS_CREATED_INDEX_SCHEMA]);
  });

  it('creates one named SNS topic without static subscriptions', () => {
    expect(Object.keys(alertTopics)).toHaveLength(1);
    expect(template.findResources('AWS::SNS::Subscription')).toStrictEqual({});
  });

  it('encrypts the topic with the request-priced AWS-managed SNS key', () => {
    const topic = Object.values(alertTopics)[0];

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
      'DYNAMODB_TABLE_BRAND_CONFIG',
      'DYNAMODB_TABLE_CONTENT_CHANGES',
      'DYNAMODB_TABLE_KEYWORD_GROUPS',
      'DYNAMODB_TABLE_KEYWORDS',
      'DYNAMODB_TABLE_KPI_ALERTS',
      'DYNAMODB_TABLE_KPI_SNAPSHOTS',
      'DYNAMODB_TABLE_SEARCH_RESULTS',
      'KPI_ALERTS_TOPIC_ARN',
    ]);
  });

  it('grants the KPI worker publish only on the alert topic', () => {
    expect(extractFunctionRoleActionsOn(template, 'CitationAnalysis-KpiAlerts', alertTopicId))
      .toStrictEqual(['sns:Publish']);
  });

  it('grants the KPI worker read access to every source table', () => {
    const sourceTables = [
      'CitationAnalysis-SearchResults',
      'CitationAnalysis-Keywords',
      'CitationAnalysis-KeywordGroups',
      'CitationAnalysis-BrandConfig',
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
    expect(extractFunctionRoleActionsOn(template, CONFIG_MGMT_FUNCTION_NAME, alertTopicId))
      .toStrictEqual([
        'sns:ListSubscriptionsByTopic',
        'sns:Publish',
        'sns:Subscribe',
        'sns:Unsubscribe',
      ]);
  });

  it('scopes the sole ConfigMgmt publish statement to the alert topic', () => {
    const roleId = findFunctionRoleLogicalId(template, CONFIG_MGMT_FUNCTION_NAME);
    const publishResources = allowStatementsOfRole(template, roleId)
      .filter((statement) => statementActions(statement).includes('sns:Publish'))
      .map((statement) => resolvePath(statement, ['Resource']));

    expect(publishResources).toStrictEqual([{ Ref: alertTopicId }]);
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

describe('Content Studio scopes batches and saved templates', () => {
  const app = new cdk.App();
  const template = Template.fromStack(new CitationAnalysisStack(app, 'ContentStudioFeatureStack'));
  const snapshot = extractContentStudioInfrastructureSnapshot(template);

  it('adds only the status creation index to the existing content table', () => {
    expect(snapshot.contentTableIndexes).toStrictEqual([
      STATUS_CREATED_INDEX_SCHEMA,
    ]);
  });

  it('enables new-image streaming on the existing content table', () => {
    expect(snapshot.contentTableStream).toStrictEqual({ StreamViewType: 'NEW_IMAGE' });
  });

  it('creates the retained on-demand batch manifest table without indexes', () => {
    expect({
      keySchema: snapshot.batchTableKeySchema,
      indexes: snapshot.batchTableIndexes,
      billingMode: snapshot.batchTableBillingMode,
      pointInTimeRecovery: snapshot.batchTablePointInTimeRecovery,
      deletionPolicy: snapshot.batchTableDeletionPolicy,
    }).toStrictEqual({
      keySchema: [{ AttributeName: 'batch_id', KeyType: 'HASH' }],
      indexes: undefined,
      billingMode: 'PAY_PER_REQUEST',
      pointInTimeRecovery: true,
      deletionPolicy: RETAIN,
    });
  });

  it('grants immutable manifest reads and conditional creates only', () => {
    expect(snapshot.environment.DYNAMODB_TABLE_CONTENT_BRIEF_BATCHES).toStrictEqual({
      Ref: snapshot.batchTableLogicalId,
    });
    expect(snapshot.batchTableActions).toStrictEqual([
      'dynamodb:GetItem',
      'dynamodb:PutItem',
    ]);
  });

  it('creates the retained on-demand template table with point-in-time recovery', () => {
    expect(snapshot.templateTableKeySchema).toStrictEqual([
      { AttributeName: 'id', KeyType: 'HASH' },
    ]);
    expect(snapshot.templateTableBillingMode).toBe('PAY_PER_REQUEST');
    expect(snapshot.templateTablePointInTimeRecovery).toBe(true);
    expect(snapshot.templateTableDeletionPolicy).toBe(RETAIN);
  });

  it('creates no template-table secondary index', () => {
    expect(snapshot.templateTableIndexes).toBeUndefined();
  });

  it('grants the API exact saved-template CRUD access', () => {
    expect(snapshot.environment).toHaveProperty('DYNAMODB_TABLE_CONTENT_BRIEF_TEMPLATES');
    expect(snapshot.templateTableActions).toStrictEqual([
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Scan',
      'dynamodb:UpdateItem',
    ]);
  });

  it('exposes the exact Content Studio route set', () => {
    const routes = snapshot.routes
      .map((route) => `${route.httpMethod} ${route.path}`)
      .sort((left, right) => left.localeCompare(right));

    expect(routes).toStrictEqual([
      'DELETE /api/content-studio/{id}',
      'DELETE /api/content-studio/templates/{id}',
      'GET /api/content-studio/batches/{batch_id}',
      'GET /api/content-studio/history',
      'GET /api/content-studio/ideas',
      'GET /api/content-studio/status/{id}',
      'GET /api/content-studio/templates',
      'POST /api/content-studio/generate',
      'POST /api/content-studio/generate-batch',
      'POST /api/content-studio/templates',
      'POST /api/content-studio/viewed',
      'PUT /api/content-studio/templates/{id}',
    ]);
  });

  it('authenticates every route and integrates the existing Content Studio Lambda', () => {
    expect(snapshot.routes.every((route) => route.authorizationType === COGNITO_AUTH)).toBe(true);
    expect(snapshot.routes.every((route) => route.authorizerId !== '')).toBe(true);
    expect(snapshot.routes.every((route) => route.integrationUri.includes(snapshot.functionLogicalId))).toBe(true);
  });

  it('caps the API at the gateway integration timeout', () => {
    expect(snapshot.apiTimeout).toBe(29);
  });

  it('reserves no API concurrency', () => {
    expect(snapshot.reservedConcurrency).toBeUndefined();
  });

  it('creates a five-minute worker with reserved concurrency ten', () => {
    expect(snapshot.workerTimeout).toBe(300);
    expect(snapshot.workerReservedConcurrency).toBe(CONTENT_STUDIO_WORKER_CONCURRENCY);
  });

  it('uses the same handler and shared layer for API and worker', () => {
    expect(snapshot.workerHandler).toBe(snapshot.apiHandler);
    expect(snapshot.workerLayerRefs).toStrictEqual(snapshot.apiLayerRefs);
  });

  it('delivers only versioned pending inserts with finite retries and age', () => {
    expect(snapshot.eventSource).toStrictEqual({
      batchSize: 1,
      startingPosition: 'TRIM_HORIZON',
      retryAttempts: 2,
      maxRecordAgeSeconds: 3600,
      filterPatterns: [JSON.stringify({
        eventName: ['INSERT'],
        dynamodb: {
          NewImage: {
            generation_transport: { S: ['dynamodb_stream_v1'] },
            status: { S: ['pending'] },
          },
        },
      })],
      tableLogicalIds: [snapshot.contentTableLogicalId],
      functionLogicalIds: [snapshot.workerFunctionLogicalId],
      onFailureQueueLogicalIds: [snapshot.streamDlq.logicalId],
    });
  });

  it('creates an encrypted fourteen-day stream failure queue', () => {
    expect({
      queueName: snapshot.streamDlq.queueName,
      retentionSeconds: snapshot.streamDlq.retentionSeconds,
      sqsManagedSseEnabled: snapshot.streamDlq.sqsManagedSseEnabled,
      sslEnforced: snapshot.streamDlq.sslEnforced,
    }).toStrictEqual({
      queueName: 'CitationAnalysis-ContentStudioStreamDLQ',
      retentionSeconds: 14 * 24 * 60 * 60,
      sqsManagedSseEnabled: true,
      sslEnforced: true,
    });
  });

  it('allows stream failure delivery to the dedicated queue', () => {
    expect(snapshot.streamDlq.workerActions).toStrictEqual([
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
      'sqs:SendMessage',
    ]);
  });

  it('creates no fixed-cost or noisy alarm for the stream failure queue', () => {
    expect(snapshot.streamDlq.alarmCount).toBe(0);
  });

  it('invokes worker reconciliation every five minutes with fixed input', () => {
    expect(snapshot.reconcileRule).toStrictEqual({
      scheduleExpression: 'rate(5 minutes)',
      state: 'ENABLED',
      targetInput: '{"action":"reconcile"}',
      functionLogicalIds: [snapshot.workerFunctionLogicalId],
    });
  });

  it('gives worker and API the same Content Studio environment contract', () => {
    const expectedWorkerEnvironment = { ...snapshot.environment };
    delete expectedWorkerEnvironment.CORS_ORIGIN_PARAM;

    expect(snapshot.workerEnvironment).toStrictEqual(expectedWorkerEnvironment);
    expect(snapshot.environment.CONTENT_STUDIO_WORKER_FUNCTION_NAME).toBe(
      CONTENT_STUDIO_WORKER_FUNCTION_NAME
    );
  });

  it('grants the worker exact content-table and stream access', () => {
    expect({
      table: snapshot.workerContentBaseActions,
      statusIndex: snapshot.workerContentStatusIndexActions,
      stream: snapshot.workerContentStreamActions,
    }).toStrictEqual({
      table: [
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
      ],
      statusIndex: ['dynamodb:Query'],
      stream: [
        'dynamodb:DescribeStream',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
      ],
    });
    expect(snapshot.workerRoleActions).toContain('dynamodb:ListStreams');
  });

  it('grants the API exact content-table and status-index access', () => {
    expect({
      table: snapshot.apiContentTableActions,
      statusIndex: snapshot.apiContentStatusIndexActions,
    }).toStrictEqual({
      table: [
        'dynamodb:BatchGetItem',
        'dynamodb:DeleteItem',
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
      ],
      statusIndex: ['dynamodb:Query'],
    });
  });

  it('grants the API no crawled-source access', () => {
    expect(snapshot.apiCrawledContentTableActions).toStrictEqual([]);
  });

  it('grants the worker exact source-table read access', () => {
    expect({
      brandConfig: snapshot.workerBrandConfigTableActions,
      crawledContent: snapshot.workerCrawledContentTableActions,
    }).toStrictEqual({
      brandConfig: ['dynamodb:GetItem'],
      crawledContent: ['dynamodb:Query'],
    });
  });

  it('grants the worker no manifest or mutable-template access', () => {
    expect({
      batches: snapshot.workerBatchTableActions,
      templates: snapshot.workerTemplateTableActions,
    }).toStrictEqual({
      batches: [],
      templates: [],
    });
  });

  it('keeps Bedrock permission on the dedicated worker', () => {
    expect(snapshot.workerRoleActions).toContain('bedrock:InvokeModel');
  });

  it('grants the API no Bedrock permission', () => {
    expect(snapshot.apiRoleActions).not.toContain('bedrock:InvokeModel');
  });

  it('lets only the worker invoke a Lambda, and only itself', () => {
    const workerArn = regionalArnJoin('lambda', 'function:CitationAnalysis-ContentStudioWorker');

    expect({
      api: snapshot.apiInvokeStatements,
      worker: snapshot.workerInvokeStatements,
    }).toStrictEqual({
      api: [],
      worker: [{
        actions: ['lambda:InvokeFunction'],
        resources: [workerArn],
      }],
    });
  });

  it('keeps every Cognito route integrated with the API function only', () => {
    expect(snapshot.routes.every((route) => route.integrationUri.includes(snapshot.functionLogicalId))).toBe(true);
    expect(snapshot.routes.every((route) => !route.integrationUri.includes(snapshot.workerFunctionLogicalId))).toBe(true);
  });
});


describe('Bedrock model access (Anthropic account enablement)', () => {
  const app = new cdk.App();
  const template = Template.fromStack(new CitationAnalysisStack(app, 'BedrockAccessStack'));
  const agreementRoleActions = extractFunctionRoleActions(template, 'CitationAnalysis-BedrockModelAgreement');

  it('subscribes exactly the foundation models lambda/shared/models.py resolves', () => {
    const subscribed = findModelAgreements(template)
      .map(([, resource]) => resolvePath(resource, ['Properties', 'modelId']))
      .filter((modelId): modelId is string => typeof modelId === 'string')
      .sort((left, right) => left.localeCompare(right));

    expect(subscribed).toStrictEqual(pythonTierFoundationModelIds());
  });

  it('gives every Bedrock-calling Lambda the role tiers lambda/shared/models.py defaults to', () => {
    const tierEnvironments = bedrockTierEnvironments(template);

    expect(tierEnvironments).toHaveLength(16);
    expect(tierEnvironments).toStrictEqual(tierEnvironments.map(() => pythonRoleDefaultTierEnv()));
  });

  it('creates the agreements in the stack region, where the Lambdas call Bedrock', () => {
    const regions = findModelAgreements(template)
      .map(([, resource]) => resolvePath(resource, ['Properties', 'region']));

    expect(regions).toStrictEqual(regions.map(() => ({ Ref: 'AWS::Region' })));
    expect(regions).toHaveLength(pythonTierFoundationModelIds().length);
  });

  it('lets the agreement handler read availability, list offers and create agreements', () => {
    expect(agreementRoleActions).toContain('bedrock:GetFoundationModelAvailability');
    expect(agreementRoleActions).toContain('bedrock:ListFoundationModelAgreementOffers');
    expect(agreementRoleActions).toContain('bedrock:CreateFoundationModelAgreement');
  });

  it('grants the agreement handler Marketplace subscribe only for Bedrock-initiated calls', () => {
    const marketplace = allowStatementsOfRole(
      template,
      findFunctionRoleLogicalId(template, 'CitationAnalysis-BedrockModelAgreement')
    ).filter((statement) => statementActions(statement).includes('aws-marketplace:Subscribe'));

    expect(marketplace).toHaveLength(1);
    expect(statementActions(marketplace[0])).toStrictEqual([
      'aws-marketplace:ViewSubscriptions',
      'aws-marketplace:Subscribe',
    ]);
    expect(resolvePath(marketplace[0], ['Condition', 'StringEquals', 'aws:CalledViaLast']))
      .toBe('bedrock.amazonaws.com');
  });

  it('keeps Marketplace permissions off the runtime roles that serve traffic', () => {
    const runtimeFunctions = [
      'CitationAnalysis-API-ContentStudio',
      'CitationAnalysis-ResearchWorker',
      ...SEARCH_PROVIDER_IDS.map(searchFunctionName),
    ];

    const marketplaceGrants = runtimeFunctions.filter((functionName) =>
      extractFunctionRoleActions(template, functionName)
        .some((action) => action.startsWith('aws-marketplace:')));

    expect(marketplaceGrants).toStrictEqual([]);
  });

  it('submits the use-case form as plain JSON, the bytes the blob parameter expects', () => {
    const parsed = findUseCaseSubmission(template);

    expect(parsed).toBeDefined();
    expect(JSON.parse(parsed?.parameters?.formData ?? '{}')).toStrictEqual({
      companyName: 'Citation Analysis',
      companyWebsite: 'https://aws.amazon.com/bedrock/',
      intendedUsers: '0',
      industryOption: 'Technology',
      otherIndustryOption: '',
      useCases: 'Summarize content and generate new marketing content.',
    });
    expect(parsed?.region).toBe('us-east-1');
  });

  it('submits the use case before any agreement, since the form gates subscription', () => {
    const agreements = findModelAgreements(template);
    const useCaseLogicalId = Object.keys(
      template.findResources('Custom::AWS')
    )[0];

    expect(agreements.length).toBeGreaterThan(0);
    expect(agreements.every(([, resource]) => {
      const dependsOn = resolvePath(resource, ['DependsOn']);
      return (Array.isArray(dependsOn) ? dependsOn : [dependsOn]).includes(useCaseLogicalId);
    })).toBe(true);
  });

  /**
   * 2.15.1 unblocked AWS-internal accounts, which refuse the form with a name
   * we have no way to observe from here. 2.16.1 stops guessing at that name: the
   * pattern tolerates every refusal and excludes only the two transient errors,
   * which must stay fatal because the submission runs `onCreate` only under a
   * fixed physical ID — a tolerated error is never retried, so swallowing a
   * transient one would leave a fresh account permanently unprovisioned and
   * silent, the failure the construct exists to prevent.
   *
   * CDK's custom-resource runtime tests this regex against the SDK error's
   * `name`, so both sides of the split are asserted by name.
   */
  it('tolerates every refusal of the use-case form, including names it cannot predict', () => {
    const refusals = [
      'ValidationException',
      'AccessDeniedException',
      'ConflictException',
      'SomeUnannouncedRefusalException',
    ];

    expect(useCaseToleratedErrorNames(template, refusals)).toStrictEqual(refusals);
  });

  it('still fails the deployment on a transient error, which is never retried', () => {
    const transient = ['ThrottlingException', 'InternalServerException'];

    expect(useCaseToleratedErrorNames(template, transient)).toStrictEqual([]);
  });
});


/**
 * 2.15.1. Not every account wants deploy-time provisioning: some have Anthropic
 * access granted by their organization, some refuse the use-case form outright,
 * and some would rather no deploy-time role held `aws-marketplace:Subscribe`.
 */
describe('Bedrock model access opt-out (-c skipModelProvisioning=true)', () => {
  const app = new cdk.App({ context: { skipModelProvisioning: 'true' } });
  const template = Template.fromStack(new CitationAnalysisStack(app, 'SkipModelProvisioningStack'));

  it('submits no use-case form and creates no model agreements', () => {
    expect(findUseCaseSubmission(template)).toBeUndefined();
    expect(findModelAgreements(template)).toStrictEqual([]);
  });

  it('leaves no role in the stack holding Marketplace permissions', () => {
    const marketplace = allowStatementsOfTemplate(template)
      .filter((statement) => statementActions(statement)
        .some((action) => action.startsWith('aws-marketplace:')));

    expect(marketplace).toStrictEqual([]);
  });

  it('reports in the stack output that nothing was subscribed', () => {
    const outputs = template.findOutputs('BedrockModelsEnabled');

    expect(resolvePath(outputs, ['BedrockModelsEnabled', 'Value']))
      .toBe('none (skipModelProvisioning)');
  });
});

/**
 * Report insights narrative (requirements 9 and 11.2): GenerateInsights runs
 * after KpiAlerts, keeps the report when it fails, and its worker reads only
 * what it needs; the stored narrative is read by the insights endpoint and
 * regenerated through an Admin route.
 */
describe('Report insights narrative', () => {
  const snapshot = extractReportInsightsSnapshot(
    Template.fromStack(new CitationAnalysisStack(new cdk.App(), 'ReportInsightsTestStack'))
  );
  const state = (name: string): unknown => resolvePath(snapshot.states, [name]);

  it('runs GenerateInsights after KpiAlerts on both of its branches', () => {
    expect(resolvePath(state('KpiAlerts'), ['Next'])).toBe('GenerateInsights');
    expect(resolvePath(state('KpiAlertsFailed'), ['Next'])).toBe('GenerateInsights');
  });

  it('hands GenerateInsights only the KpiAlerts result and keeps its own under narratives', () => {
    expect(resolvePath(state('GenerateInsights'), ['Parameters'])).toStrictEqual({ 'alerts.$': '$.alerts' });
    expect(resolvePath(state('GenerateInsights'), ['ResultPath'])).toBe('$.narratives');
  });

  it('catches every GenerateInsights failure into a Pass that keeps the report', () => {
    expect(resolvePath(state('GenerateInsights'), ['Catch'])).toStrictEqual([
      { ErrorEquals: ['States.ALL'], ResultPath: null, Next: 'GenerateInsightsFailed' },
    ]);
    expect(resolvePath(state('GenerateInsightsFailed'), ['Type'])).toBe('Pass');
    expect(resolvePath(state('GenerateInsightsFailed'), ['ResultPath'])).toBe('$.narratives');
    expect(resolvePath(state('GenerateInsightsFailed'), ['End'])).toBe(true);
  });

  it('keys the narrative table by scope and run', () => {
    expect(snapshot.table.keySchema).toStrictEqual([
      { AttributeName: 'scope_key', KeyType: 'HASH' },
      { AttributeName: 'run_timestamp', KeyType: 'RANGE' },
    ]);
  });

  it('bills the narrative table on demand and expires it through ttl like the KPI snapshots', () => {
    expect(snapshot.table.billingMode).toBe('PAY_PER_REQUEST');
    expect(snapshot.table.timeToLive).toStrictEqual({ AttributeName: 'ttl', Enabled: true });
  });

  it('bounds the worker at 120 seconds on the shared layer', () => {
    expect(snapshot.workerTimeoutSeconds).toBe(120);
    expect(snapshot.workerLayerCount).toBe(1);
  });

  it('hands the worker the tables it reads and writes', () => {
    expect(snapshot.workerEnvironmentNames.filter((name) => name.startsWith('DYNAMODB_TABLE_'))).toStrictEqual([
      'DYNAMODB_TABLE_BRAND_CONFIG',
      'DYNAMODB_TABLE_KEYWORDS',
      'DYNAMODB_TABLE_PROVIDER_CONFIG',
      'DYNAMODB_TABLE_REPORT_INSIGHTS',
      'DYNAMODB_TABLE_SEARCH_RESULTS',
    ]);
  });

  it('lets the worker read its source tables, the saved Bedrock models, and only put narratives', () => {
    const read = ['dynamodb:BatchGetItem', 'dynamodb:ConditionCheckItem', 'dynamodb:DescribeTable', 'dynamodb:GetItem',
      'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:Query', 'dynamodb:Scan'];

    expect(snapshot.workerTableActions).toStrictEqual({
      'CitationAnalysis-SearchResults': read,
      'CitationAnalysis-Keywords': read,
      'CitationAnalysis-ProviderConfig': ['dynamodb:GetItem'],
      'CitationAnalysis-BrandConfig': read,
      'CitationAnalysis-ReportInsights': ['dynamodb:PutItem'],
    });
  });

  it('lets the worker invoke Bedrock models and nothing outside DynamoDB and Bedrock', () => {
    expect(snapshot.workerActions.filter((action) => !action.startsWith('dynamodb:'))).toStrictEqual(['bedrock:InvokeModel']);
  });

  it('lets StatsInsights read stored narratives without writing them', () => {
    expect(snapshot.statsInsightsReportInsightsActions).toStrictEqual(['dynamodb:GetItem']);
    expect(snapshot.statsInsightsEnvironment).toHaveProperty('DYNAMODB_TABLE_REPORT_INSIGHTS');
  });

  it('lets StatsInsights start the worker it is told the name of', () => {
    expect(snapshot.statsInsightsWorkerActions).toStrictEqual(['lambda:InvokeFunction']);
    expect(snapshot.statsInsightsEnvironment).toHaveProperty('REPORT_INSIGHTS_FUNCTION_NAME');
  });

  it('routes POST regenerate to StatsInsights behind the Cognito authorizer', () => {
    expect(sortedHttpMethods(snapshot.regenerateMethods)).toStrictEqual(['POST']);
    expect(unguardedVerbs(snapshot.regenerateMethods, snapshot.statsInsightsFunctionLogicalId)).toStrictEqual(FULLY_GUARDED);
  });
});

describe('Bedrock model picker (Settings › Bedrock models, 2.36.0)', () => {
  const picker = (): BedrockModelPickerSnapshot => synthesized.bedrockModelPicker;

  it('finds exactly the Lambdas that call shared.models', () => {
    expect(Object.keys(picker().callers)).toStrictEqual(SAVED_BEDROCK_MODEL_CALLERS);
  });

  it.each(SAVED_BEDROCK_MODEL_CALLERS)('hands %s the ProviderConfig table name', (functionName) => {
    expect(picker().callers[functionName]?.tableEnv).toStrictEqual({ Ref: picker().providerConfigTableLogicalId });
  });

  it.each(SAVED_BEDROCK_MODEL_CALLERS)('lets %s read the saved tier models', (functionName) => {
    expect(picker().callers[functionName]?.tableActions).toContain('dynamodb:GetItem');
  });

  it('lets ConfigMgmt test a model with the same Claude-only InvokeModel grant the runtime roles hold', () => {
    expect(picker().configMgmtInvokeStatements).toStrictEqual([{
      actions: ['bedrock:InvokeModel'],
      resources: [
        { 'Fn::Join': ['', ['arn:aws:bedrock:*:', { Ref: 'AWS::AccountId' }, ':inference-profile/global.anthropic.claude-*']] },
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
        'arn:aws:bedrock:::foundation-model/anthropic.claude-*',
      ],
    }]);
  });

  it('lets ConfigMgmt list inference profiles and read service quotas, which take no resource ARNs', () => {
    expect(picker().configMgmtWildcardStatements).toStrictEqual([
      { actions: ['bedrock:GetInferenceProfile', 'bedrock:ListInferenceProfiles'], resources: ['*'] },
      { actions: ['servicequotas:GetServiceQuota', 'servicequotas:ListServiceQuotas'], resources: ['*'] },
    ]);
  });

  it('gives ConfigMgmt no Marketplace permissions', () => {
    expect(picker().configMgmtActions.filter((action) => action.startsWith('aws-marketplace:'))).toStrictEqual([]);
  });

  it('reuses the existing provider routes instead of adding API resources', () => {
    expect(picker().providerIdChildPathParts).toStrictEqual(['models', 'validate']);
  });
});
