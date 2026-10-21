import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { CitationAnalysisStack } from './citation-analysis-stack';
import {
  extractApiAuthSnapshots,
  extractFunctionRoleActionsOn,
  extractLambdaEnvVars,
  findFunctionRoleLogicalId,
  findLogicalIdByName,
  resolvePath,
} from './citation-analysis-stack-fixtures';

/** One entry of `test-fixtures/route-size-policies.json`. */
export interface RouteSizePolicy {
  route: string;
  methods: string[];
  policy: 'paginated' | 'top_n' | 'summary' | 'single_item' | 'bounded';
  bound: string;
  volume_test: string | null;
}

/** What an API Lambda needs to spill a response too large for the 6 MiB cap. */
interface SpillAccess {
  bucketEnv: unknown;
  bucketActions: string[];
  grantsSpillPrefix: boolean;
}

/** The response-size infrastructure of the main stack. */
export interface ResponseSizeSnapshot {
  /** `METHOD /path` of every API Gateway method except the CORS preflights. */
  apiRoutes: string[];
  keywordsBucketLogicalId: string;
  keywordsBucketCors: unknown;
  minimumCompressionSize: unknown;
  spillAccess: Record<string, SpillAccess>;
}

/** The functions behind API Gateway routes (each builds its responses with `shared.api_response`). */
export const API_FUNCTION_NAMES = [
  'CitationAnalysis-API-Health',
  'CitationAnalysis-API-StatsInsights',
  'CitationAnalysis-API-CitationsContent',
  'CitationAnalysis-API-KeywordMgmt',
  'CitationAnalysis-API-ConfigMgmt',
  'CitationAnalysis-API-ExecutionMgmt',
  'CitationAnalysis-API-GetBrandMentions',
  'CitationAnalysis-API-ManageBrandConfig',
  'CitationAnalysis-API-ContentStudio',
  'CitationAnalysis-API-ManageUsers',
  'CitationAnalysis-API-GetPersonaRankings',
  'CitationAnalysis-API-SelfReflection',
];

const POLICIES_FILE = path.join(__dirname, '..', 'test-fixtures', 'route-size-policies.json');

/** The route size-policy registry the Python contract test reads too. */
export function readRouteSizePolicies(): RouteSizePolicy[] {
  const parsed: unknown = JSON.parse(readFileSync(POLICIES_FILE, 'utf-8'));
  const routes = resolvePath(parsed, ['routes']);
  return Array.isArray(routes) ? routes.filter((entry): entry is RouteSizePolicy => typeof entry === 'object' && entry !== null) : [];
}

/** `METHOD /path` of every route a registry entry declares. */
export function declaredRoutes(policies: readonly RouteSizePolicy[]): string[] {
  return policies.flatMap((entry) => entry.methods.map((method) => `${method} ${entry.route}`));
}

function spillAccess(template: Template, functionName: string, bucketLogicalId: string): SpillAccess {
  const roleId = findFunctionRoleLogicalId(template, functionName);
  const policies = [
    ...Object.values(template.findResources('AWS::IAM::Policy')),
    ...Object.values(template.findResources('AWS::IAM::ManagedPolicy')),
  ].filter((policy) => JSON.stringify(resolvePath(policy, ['Properties', 'Roles'])).includes(`"${roleId}"`));
  return {
    bucketEnv: extractLambdaEnvVars(template, functionName).API_RESPONSE_BUCKET,
    bucketActions: extractFunctionRoleActionsOn(template, functionName, bucketLogicalId),
    grantsSpillPrefix: policies.some((policy) => JSON.stringify(policy).includes('/api-responses/*')),
  };
}

export function synthesizeResponseSizeSnapshot(): ResponseSizeSnapshot {
  const template = Template.fromStack(new CitationAnalysisStack(new cdk.App(), 'ResponseSizeTestStack'));
  const keywordsBucketLogicalId = Object.keys(template.findResources('AWS::S3::Bucket')).find(
    (logicalId) => logicalId.startsWith('KeywordsBucket'),
  ) ?? '';
  const restApiId = findLogicalIdByName(template, 'AWS::ApiGateway::RestApi', 'Name', 'CitationAnalysis-API');
  return {
    apiRoutes: extractApiAuthSnapshots(template).map((method) => `${method.httpMethod} ${method.path}`),
    keywordsBucketLogicalId,
    keywordsBucketCors: resolvePath(template.toJSON(), ['Resources', keywordsBucketLogicalId, 'Properties', 'CorsConfiguration']),
    minimumCompressionSize: resolvePath(template.toJSON(), ['Resources', restApiId, 'Properties', 'MinimumCompressionSize']),
    spillAccess: Object.fromEntries(API_FUNCTION_NAMES.map((name) => [name, spillAccess(template, name, keywordsBucketLogicalId)])),
  };
}
