import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CitationAnalysisStack } from './citation-analysis-stack';
import {
  COGNITO_AUTH,
  allowStatementsOfRole,
  extractApiAuthSnapshots,
  extractLambdaEnvVars,
  extractReservedConcurrency,
  extractWorkflowScaleSnapshot,
  findFunctionRoleLogicalId,
  methodRouteLabels,
  providerSearchBranch,
  providerSearchBranchStarts,
  resolvePath,
  resolveString,
  searchFunctionName,
} from './citation-analysis-stack-fixtures';
import { CitationAnalysisSeoStack } from './seo-stack';

export const SEO_ROUTER = 'CitationAnalysis-SeoRouter';
export const AI_OVERVIEW_SEARCH = searchFunctionName('google_ai_overview');

/** The SEO stack and the main stack around it, as synthesized. */
interface SeoStackSnapshot {
  template: Template;
  resourceCount: number;
  /** Every `Fn::ImportValue` of the SEO template (`"Fn::ImportValue":"<name>"`). */
  importValues: string[];
  /** The distinct export names the SEO template imports, sorted. */
  importNames: string[];
  /** The prod stage's method settings and SeoCache's TTL specification. */
  stageMethodSettings: unknown;
  cacheTimeToLive: unknown;
  /** `"<VERB> <path>"` of every method that is not a CORS preflight. */
  routes: string[];
  /** Routes of non-preflight methods whose authorization is not the Cognito user pool authorizer. */
  routesWithoutCognito: string[];
  /** `TableName` → `BillingMode` of the template's tables. */
  tableBillingModes: Record<string, unknown>;
  routerEnv: Record<string, unknown>;
  /** Sorted names of the main-stack (`CitationAnalysis-*`, imported by name) tables the router's role may touch. */
  routerMainTables: string[];
  /** Sorted environment variable names of the AI Overviews function and of a main-stack provider function. */
  aiOverviewEnvKeys: string[];
  mainProviderEnvKeys: string[];
  aiOverviewReservedConcurrency: number | undefined;
  /** DynamoDB actions of the AI Overviews search role on SearchResults and on ProviderConfig. */
  aiOverviewSearchResultsActions: string[];
  aiOverviewProviderConfigActions: string[];
  /** S3 actions of the AI Overviews search role; DynamoDB actions of the router on the SEO keyword metrics and cache. */
  aiOverviewS3Actions: string[];
  routerKeywordMetricsActions: string[];
  routerCacheActions: string[];
  mainResourceCount: number;
  mainResourceCountWithSeoEngine: number;
  /** SearchAllProviders branch start states without and with `-c seoEngine=true`. */
  mainBranchStarts: unknown[];
  mainBranchStartsWithSeoEngine: unknown[];
  /** With `-c seoEngine=true`: each branch's `Search-<id>` task, keyed by the branch start state's provider id. */
  mainSearchTasksWithSeoEngine: Record<string, unknown>;
}

const ENV = { account: '123456789012', region: 'eu-west-1' };

function resourceCount(template: Template): number {
  const resources = resolvePath(template.toJSON(), ['Resources']);
  return Object.keys(typeof resources === 'object' && resources !== null ? resources : {}).length;
}

function tableBillingModes(template: Template): Record<string, unknown> {
  return Object.fromEntries(Object.values(template.findResources('AWS::DynamoDB::Table')).map((table) => [
    resolveString(table, ['Properties', 'TableName']),
    resolvePath(table, ['Properties', 'BillingMode']),
  ]));
}

/** A property of the template's only resource of `type` (`undefined` when there is none). */
function onlyResourceProperty(template: Template, type: string, keys: string[], props: Record<string, unknown> = {}): unknown {
  const [resource] = Object.values(template.findResources(type, { Properties: props }));
  return resolvePath(resource, ['Properties', ...keys]);
}

function mainTablesOfRole(template: Template, functionName: string): string[] {
  const statements = JSON.stringify(allowStatementsOfRole(template, findFunctionRoleLogicalId(template, functionName)));
  const names = [...statements.matchAll(/table\/(CitationAnalysis-[A-Za-z]+)/g)].map((match) => match[1]);
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

/** The distinct actions of `statements` that start with `prefix` (for example `s3:`), sorted. */
function actionsOf(statements: unknown[], prefix: string): string[] {
  const actions = statements.flatMap((statement) => {
    const action = resolvePath(statement, ['Action']);
    return Array.isArray(action) ? action.map(String) : [String(action)];
  });
  return [...new Set(actions)].filter((action) => action.startsWith(prefix)).sort((left, right) => left.localeCompare(right));
}

function roleStatements(template: Template, functionName: string): unknown[] {
  return allowStatementsOfRole(template, findFunctionRoleLogicalId(template, functionName));
}

/**
 * The DynamoDB actions the function's role is allowed on table `tableName`, sorted: a main-stack table by its name in
 * the ARN, a table of this stack by its logical id in the `Fn::GetAtt`.
 */
function mainTableActionsOfRole(template: Template, functionName: string, tableName: string): string[] {
  const local = Object.entries(template.findResources('AWS::DynamoDB::Table'))
    .find(([, table]) => resolvePath(table, ['Properties', 'TableName']) === tableName)?.[0];
  const names = [`table/${tableName}`, ...(local === undefined ? [] : [`"${local}"`])];
  const onTable = roleStatements(template, functionName).filter((statement) => {
    const resource = JSON.stringify(resolvePath(statement, ['Resource']));
    return names.some((name) => resource.includes(name));
  });
  return actionsOf(onTable, 'dynamodb:');
}

/** Every action of the function's role that starts with `prefix`, sorted. */
function roleActions(template: Template, functionName: string, prefix: string): string[] {
  return actionsOf(roleStatements(template, functionName), prefix);
}

function sortedEnvKeys(template: Template, functionName: string): string[] {
  return Object.keys(extractLambdaEnvVars(template, functionName)).sort((left, right) => left.localeCompare(right));
}

function branchStarts(template: Template): unknown[] {
  return providerSearchBranchStarts(extractWorkflowScaleSnapshot(template).definition);
}

/** Each SearchAllProviders branch's `Search-<id>` task state, keyed by provider id. */
function searchTasks(template: Template): Record<string, unknown> {
  const { definition } = extractWorkflowScaleSnapshot(template);
  return Object.fromEntries(providerSearchBranchStarts(definition).map((start) => {
    const providerId = String(start).slice('Search-'.length);
    return [providerId, resolvePath(providerSearchBranch(definition, providerId), ['States', `Search-${providerId}`])];
  }));
}

/** The main stack of a fresh app with the given CDK context. */
function synthesizeMain(context: Record<string, string>): Template {
  const app = new cdk.App({ context });
  return Template.fromStack(new CitationAnalysisStack(app, 'MainStack', { env: ENV }));
}

/** Synthesize the SEO stack with its main stack, and the main stack again with `seoEngine=true`. */
export function synthesizeSeoStackSnapshot(): SeoStackSnapshot {
  const app = new cdk.App();
  const main = new CitationAnalysisStack(app, 'MainStack', { env: ENV });
  const seoStack = new CitationAnalysisSeoStack(app, 'SeoStack', { env: ENV, inputs: main.seoInputs });
  const template = Template.fromStack(seoStack);
  const mainTemplate = Template.fromStack(main);
  const mainWithSeoEngine = synthesizeMain({ seoEngine: 'true' });
  const methods = extractApiAuthSnapshots(template);
  const importValues = JSON.stringify(template.toJSON()).match(/"Fn::ImportValue":"[^"]+"/g) ?? [];
  return {
    template,
    resourceCount: resourceCount(template),
    importValues,
    importNames: [...new Set(importValues.map((value) => value.slice('"Fn::ImportValue":"'.length, -1)))]
      .sort((left, right) => left.localeCompare(right)),
    stageMethodSettings: onlyResourceProperty(template, 'AWS::ApiGateway::Stage', ['MethodSettings']),
    cacheTimeToLive: onlyResourceProperty(
      template, 'AWS::DynamoDB::Table', ['TimeToLiveSpecification'], { TableName: 'CitationAnalysis-SeoCache' }
    ),
    routes: methodRouteLabels(methods).sort((left, right) => left.localeCompare(right)),
    routesWithoutCognito: methodRouteLabels(methods.filter((method) => method.authorizationType !== COGNITO_AUTH)),
    tableBillingModes: tableBillingModes(template),
    routerEnv: extractLambdaEnvVars(template, SEO_ROUTER),
    routerMainTables: mainTablesOfRole(template, SEO_ROUTER),
    aiOverviewEnvKeys: sortedEnvKeys(template, AI_OVERVIEW_SEARCH),
    mainProviderEnvKeys: sortedEnvKeys(mainTemplate, searchFunctionName('openai')),
    aiOverviewReservedConcurrency: extractReservedConcurrency(template, AI_OVERVIEW_SEARCH),
    aiOverviewSearchResultsActions: mainTableActionsOfRole(template, AI_OVERVIEW_SEARCH, 'CitationAnalysis-SearchResults'),
    aiOverviewProviderConfigActions: mainTableActionsOfRole(template, AI_OVERVIEW_SEARCH, 'CitationAnalysis-ProviderConfig'),
    aiOverviewS3Actions: roleActions(template, AI_OVERVIEW_SEARCH, 's3:'),
    routerKeywordMetricsActions: mainTableActionsOfRole(template, SEO_ROUTER, 'CitationAnalysis-SeoKeywordMetrics'),
    routerCacheActions: mainTableActionsOfRole(template, SEO_ROUTER, 'CitationAnalysis-SeoCache'),
    mainResourceCount: resourceCount(mainTemplate),
    mainResourceCountWithSeoEngine: resourceCount(mainWithSeoEngine),
    mainBranchStarts: branchStarts(mainTemplate),
    mainBranchStartsWithSeoEngine: branchStarts(mainWithSeoEngine),
    mainSearchTasksWithSeoEngine: searchTasks(mainWithSeoEngine),
  };
}
