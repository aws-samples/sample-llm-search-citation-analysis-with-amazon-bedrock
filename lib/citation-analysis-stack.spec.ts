import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';
import { CitationAnalysisStack } from './citation-analysis-stack';

const KEYWORD_MGMT_FUNCTION_NAME = 'CitationAnalysis-API-KeywordMgmt';
const KEYWORD_MGMT_ROLE_PREFIX = 'KeywordMgmtFunctionServiceRole';
const KEYWORDS_TABLE_PREFIX = 'KeywordsTable';
// API Gateway adds a CORS preflight method on every resource; route assertions ignore it.
const PREFLIGHT_METHOD = 'OPTIONS';

interface ApiGatewayResourceProperties {
  PathPart: string;
  ParentId?: { Ref?: string };
}

interface ApiGatewayMethodProperties {
  HttpMethod: string;
  ResourceId?: { Ref?: string };
  Integration: { Type: string; Uri: unknown };
}

interface IamPolicyProperties {
  Roles: unknown;
  PolicyDocument: { Statement: { Action: string | string[]; Resource?: unknown }[] };
}

// Logical ids resolved from the synthesized template in beforeAll, so the keyword route
// assertions do not hard-code CDK-generated suffixes.
const keywordRouteIds = {
  mgmtFunction: '',
  keywords: '',
  promote: '',
  keywordId: '',
};

let template: Template;
let definitionRaw: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let crawlerEnvVars: Record<string, any>;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new CitationAnalysisStack(app, 'TestStack');
  template = Template.fromStack(stack);

  // Extract the Step Functions definition from the Fn::Join
  const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
  const logicalId = Object.keys(stateMachines)[0];
  const defString = stateMachines[logicalId].Properties.DefinitionString;

  // Fn::Join produces ["", [...parts]]
  // Concatenate string parts, replace object refs with a placeholder
  const parts = defString['Fn::Join'][1] as unknown[];
  definitionRaw = parts
    .map((p) => (typeof p === 'string' ? p : '"__REF__"'))
    .join('');

  // Extract Crawler Lambda env vars
  const lambdas = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: 'CitationAnalysis-Crawler' },
  });
  const crawlerLogicalId = Object.keys(lambdas)[0];
  crawlerEnvVars = lambdas[crawlerLogicalId].Properties.Environment.Variables;

  // Resolve the KeywordMgmt function and the /api/keywords resource tree
  const keywordMgmtLambdas = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: KEYWORD_MGMT_FUNCTION_NAME },
  });
  keywordRouteIds.mgmtFunction = Object.keys(keywordMgmtLambdas)[0];

  const apiResources = findApiResources(template);
  const idOfPathPart = (pathPart: string, parentId?: string): string =>
    Object.keys(apiResources).find(
      (id) =>
        apiResources[id].Properties.PathPart === pathPart &&
        (parentId === undefined || apiResources[id].Properties.ParentId?.Ref === parentId),
    ) ?? '';

  keywordRouteIds.keywords = idOfPathPart('keywords');
  keywordRouteIds.promote = idOfPathPart('promote', keywordRouteIds.keywords);
  keywordRouteIds.keywordId = idOfPathPart('{id}', keywordRouteIds.keywords);
}, 60_000);

function findApiResources(from: Template): Record<string, { Properties: ApiGatewayResourceProperties }> {
  return from.findResources('AWS::ApiGateway::Resource') as Record<
    string,
    { Properties: ApiGatewayResourceProperties }
  >;
}

function findWiredMethods(from: Template, resourceLogicalId: string): ApiGatewayMethodProperties[] {
  const methods = from.findResources('AWS::ApiGateway::Method') as Record<
    string,
    { Properties: ApiGatewayMethodProperties }
  >;

  return Object.values(methods)
    .map((m) => m.Properties)
    .filter((p) => p.ResourceId?.Ref === resourceLogicalId && p.HttpMethod !== PREFLIGHT_METHOD);
}

describe('Step Functions workflow', () => {
  it('passes keyword to CrawlCitations Map itemSelector', () => {
    // Verify the CrawlCitations state includes keyword.$ in its ItemSelector
    expect(definitionRaw).toContain('"keyword.$":"$.keyword"');
  });

  it('passes query_prompts to ProcessKeywords Map itemSelector', () => {
    expect(definitionRaw).toContain('"query_prompts.$":"$$.Execution.Input.query_prompts"');
  });
});

describe('Keyword promotion route', () => {
  it('exposes promote as a child of the keywords resource', () => {
    expect(keywordRouteIds.keywords).not.toBe('');
    expect(keywordRouteIds.promote).not.toBe('');

    const promoteResource = findApiResources(template)[keywordRouteIds.promote];

    expect(promoteResource.Properties.PathPart).toBe('promote');
    expect(promoteResource.Properties.ParentId?.Ref).toBe(keywordRouteIds.keywords);
  });

  it('exposes POST on the promote resource integrated to the KeywordMgmt function', () => {
    const promoteMethods = findWiredMethods(template, keywordRouteIds.promote);

    expect(promoteMethods).toHaveLength(1);
    expect(promoteMethods[0].HttpMethod).toBe('POST');
    expect(promoteMethods[0].Integration.Type).toBe('AWS_PROXY');
    expect(JSON.stringify(promoteMethods[0].Integration.Uri)).toContain(keywordRouteIds.mgmtFunction);
  });

  it('does not conflict with the sibling keyword id resource', () => {
    const idVerbs = findWiredMethods(template, keywordRouteIds.keywordId).map((p) => p.HttpMethod);

    expect([...idVerbs].sort((a, b) => a.localeCompare(b))).toStrictEqual(['DELETE', 'PUT']);
    expect(idVerbs).not.toContain('POST');
  });

  it('grants the KeywordMgmt function read and write on the keywords table', () => {
    const policies = template.findResources('AWS::IAM::Policy') as Record<
      string,
      { Properties: IamPolicyProperties }
    >;
    const keywordMgmtPolicies = Object.values(policies)
      .map((p) => p.Properties)
      .filter((p) => JSON.stringify(p.Roles).includes(KEYWORD_MGMT_ROLE_PREFIX));

    expect(keywordMgmtPolicies.length).toBeGreaterThan(0);

    const keywordsTableActions = keywordMgmtPolicies
      .flatMap((p) => p.PolicyDocument.Statement)
      .filter((s) => JSON.stringify(s.Resource ?? '').includes(KEYWORDS_TABLE_PREFIX))
      .flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));

    expect(keywordsTableActions).toContain('dynamodb:Scan');
    expect(keywordsTableActions).toContain('dynamodb:BatchWriteItem');
    expect(keywordsTableActions).toContain('dynamodb:PutItem');
  });
});

describe('Crawler Lambda environment', () => {
  it('does not include unused BROWSER_TIMEOUT_MS env var', () => {
    expect(crawlerEnvVars).not.toHaveProperty('BROWSER_TIMEOUT_MS');
  });

  it('does not include unused PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD env var', () => {
    expect(crawlerEnvVars).not.toHaveProperty('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD');
  });

  it('does not include unused NOVA_ACT_SECRET_NAME env var', () => {
    expect(crawlerEnvVars).not.toHaveProperty('NOVA_ACT_SECRET_NAME');
  });
});
