import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  describe, it, expect, beforeAll
} from 'vitest';
import { CitationAnalysisStack } from './citation-analysis-stack';

const KEYWORD_MGMT_FUNCTION_NAME = 'CitationAnalysis-API-KeywordMgmt';
const PREFLIGHT_METHOD = 'OPTIONS';

interface ApiGatewayMethodSnapshot {
  httpMethod: string;
  integrationType: string;
  integrationUri: string;
  authorizationType: string;
  authorizerId: string;
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

const synthesized: {
  definitionRaw: string;
  crawlerEnvVars: Record<string, unknown>;
  parseKeywordsEnvVars: Record<string, unknown>;
  keywordMgmtFunctionId: string;
  promoteMethods: ApiGatewayMethodSnapshot[];
  keywordIdMethods: ApiGatewayMethodSnapshot[];
} = {
  definitionRaw: '',
  crawlerEnvVars: {},
  parseKeywordsEnvVars: {},
  keywordMgmtFunctionId: '',
  promoteMethods: [],
  keywordIdMethods: [],
};

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
}, 60_000);

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
