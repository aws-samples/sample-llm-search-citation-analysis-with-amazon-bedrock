import { Template } from 'aws-cdk-lib/assertions';
import { synthesizeDashboardStacks } from './api-stack-fixtures';
import {
  type ApiGatewayMethodSnapshot,
  extractApiMethods,
  extractFunctionRoleActionsOn,
  extractLambdaEnvVars,
  extractWorkflowScaleSnapshot,
  findApiResourceId,
  findLambdaLogicalId,
  findLogicalIdByName,
  resolvePath,
} from './citation-analysis-stack-fixtures';

const CONFIG_MGMT = 'CitationAnalysis-API-ConfigMgmt';
const KEYWORD_MGMT = 'CitationAnalysis-API-KeywordMgmt';
const PARSE_KEYWORDS = 'CitationAnalysis-ParseKeywords';

/** One Lambda's view of a table: the env var naming it and the actions its role has on it. */
interface TableAccess {
  envRef: unknown;
  actions: string[];
}

/** Everything the markets feature (2.37.0) adds to the main stack. */
interface MarketsSnapshot {
  resourceCount: number;
  marketsMethods: ApiGatewayMethodSnapshot[];
  marketsPreflightCount: number;
  configMgmtFunctionLogicalId: string;
  brandConfigTableLogicalId: string;
  keywordsTableLogicalId: string;
  configMgmtEnv: Record<string, unknown>;
  configMgmtBrandConfig: TableAccess;
  configMgmtKeywords: TableAccess;
  keywordMgmtBrandConfig: TableAccess;
  parseKeywordsBrandConfig: TableAccess;
  processKeywordsItemSelector: unknown;
}

function tableAccess(template: Template, functionName: string, envName: string, tableLogicalId: string): TableAccess {
  return {
    envRef: extractLambdaEnvVars(template, functionName)[envName],
    actions: extractFunctionRoleActionsOn(template, functionName, tableLogicalId),
  };
}

function preflightCount(template: Template, resourceId: string): number {
  return Object.values(template.findResources('AWS::ApiGateway::Method'))
    .filter((method) => resolvePath(method, ['Properties', 'ResourceId', 'Ref']) === resourceId)
    .filter((method) => resolvePath(method, ['Properties', 'HttpMethod']) === 'OPTIONS')
    .length;
}

/** Synthesize the main and API stacks once and read the markets wiring out of them. */
export function synthesizeMarketsSnapshot(): MarketsSnapshot {
  const { mainTemplate: template, apiTemplate } = synthesizeDashboardStacks('MarketsTest');
  const brandConfigTableLogicalId = findLogicalIdByName(template, 'AWS::DynamoDB::Table', 'TableName', 'CitationAnalysis-BrandConfig');
  const keywordsTableLogicalId = findLogicalIdByName(template, 'AWS::DynamoDB::Table', 'TableName', 'CitationAnalysis-Keywords');
  const marketsId = findApiResourceId(apiTemplate, 'markets');
  const resources = resolvePath(template.toJSON(), ['Resources']);
  return {
    resourceCount: Object.keys(typeof resources === 'object' && resources !== null ? resources : {}).length,
    marketsMethods: extractApiMethods(apiTemplate, marketsId),
    marketsPreflightCount: preflightCount(apiTemplate, marketsId),
    configMgmtFunctionLogicalId: findLambdaLogicalId(template, CONFIG_MGMT),
    brandConfigTableLogicalId,
    keywordsTableLogicalId,
    configMgmtEnv: extractLambdaEnvVars(template, CONFIG_MGMT),
    configMgmtBrandConfig: tableAccess(template, CONFIG_MGMT, 'DYNAMODB_TABLE_BRAND_CONFIG', brandConfigTableLogicalId),
    configMgmtKeywords: tableAccess(template, CONFIG_MGMT, 'DYNAMODB_TABLE_KEYWORDS', keywordsTableLogicalId),
    keywordMgmtBrandConfig: tableAccess(template, KEYWORD_MGMT, 'DYNAMODB_TABLE_BRAND_CONFIG', brandConfigTableLogicalId),
    parseKeywordsBrandConfig: tableAccess(template, PARSE_KEYWORDS, 'DYNAMODB_TABLE_BRAND_CONFIG', brandConfigTableLogicalId),
    processKeywordsItemSelector: resolvePath(
      extractWorkflowScaleSnapshot(template).definition, ['States', 'ProcessKeywords', 'ItemSelector'],
    ),
  };
}
