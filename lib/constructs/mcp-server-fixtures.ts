import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';

import {
  allowStatementsOfRole,
  extractLambdaEnvVars,
  findFunctionRoleLogicalId,
  findLambdaLogicalId,
  resolvePath,
  resolveString,
  statementActions,
} from '../citation-analysis-stack-fixtures';
import { McpServer } from './mcp-server';
import { McpState } from './mcp-state';

export const MCP_FUNCTION_NAME = 'CitationAnalysis-Mcp';
export const TEST_REGION = 'eu-west-1';
export const TEST_DOMAIN_PREFIX = 'citation-analysis-123456789012';
export const TEST_REDIRECT_URIS = ['http://localhost:6274/oauth/callback'];
const TEST_PINNED_TOOLS = ['list_providers', 'get_dashboard_stats'];
/** Two of the contract's eight routers are enough to prove the mapping and the grant are per function. */
const STUB_ROUTER_FUNCTIONS: Record<string, string> = {
  'keyword-mgmt': 'Stub-KeywordMgmt',
  'config-mgmt': 'Stub-ConfigMgmt',
};

/** What every intrinsic (`Ref`, `Fn::GetAtt`, ...) becomes in a rendered string. */
export const REF = '<ref>';

export interface SynthesizedMcpServer {
  template: Template;
  /** `McpServer.resourceMetadataUrl` as the stack resolves it, rendered by `renderString`. */
  resourceMetadataUrl: string;
}

/** The pool, layer and two stub routers the construct needs, then the construct (which owns its API and authorizer). */
export function synthesizeMcpServer(): SynthesizedMcpServer {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'McpTestStack', { env: { account: '123456789012', region: TEST_REGION } });
  const userPool = new cognito.UserPool(stack, 'UserPool');
  const sharedLayer = new lambda.LayerVersion(stack, 'SharedLayer', {
    code: lambda.Code.fromBucket(s3.Bucket.fromBucketName(stack, 'LayerBucket', 'layer-bucket'), 'shared-layer.zip'),
    compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
  });
  const apiFunctions = Object.fromEntries(
    Object.entries(STUB_ROUTER_FUNCTIONS).map(([router, functionName]) => [
      router,
      new lambda.Function(stack, functionName, {
        functionName,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'handler.handler',
        code: lambda.Code.fromInline('def handler(event, context):\n    return event\n'),
      }),
    ])
  );

  const server = new McpServer(stack, 'McpServer', {
    userPool,
    sharedLayer,
    apiFunctions,
    redirectUris: TEST_REDIRECT_URIS,
    pinnedTools: TEST_PINNED_TOOLS,
    domainPrefix: TEST_DOMAIN_PREFIX,
    state: new McpState(stack, 'McpState'),
  });
  const resourceMetadataUrl: unknown = stack.resolve(server.resourceMetadataUrl);
  return { template: Template.fromStack(stack), resourceMetadataUrl: renderString(resourceMetadataUrl) };
}

export interface McpTemplateIds {
  functionId: string;
  clientId: string;
  authorizerId: string;
  restApiId: string;
  sharedLayerId: string;
  stubFunctionIds: string[];
  userPoolId: string;
}

function soleLogicalId(template: Template, resourceType: string): string {
  return Object.keys(template.findResources(resourceType))[0] ?? '';
}

/** Logical ids the assertions compare references against; each type occurs once in the test stack. */
export function extractMcpTemplateIds(template: Template): McpTemplateIds {
  return {
    functionId: findLambdaLogicalId(template, MCP_FUNCTION_NAME),
    clientId: soleLogicalId(template, 'AWS::Cognito::UserPoolClient'),
    authorizerId: soleLogicalId(template, 'AWS::ApiGateway::Authorizer'),
    restApiId: soleLogicalId(template, 'AWS::ApiGateway::RestApi'),
    sharedLayerId: soleLogicalId(template, 'AWS::Lambda::LayerVersion'),
    stubFunctionIds: Object.values(STUB_ROUTER_FUNCTIONS).map((name) => findLambdaLogicalId(template, name)),
    userPoolId: soleLogicalId(template, 'AWS::Cognito::UserPool'),
  };
}

/**
 * A CloudFormation string value as text: literal strings as they are, the
 * parts of an `Fn::Join` concatenated with every intrinsic replaced by
 * `placeholder`, and a bare intrinsic as the placeholder itself.
 */
export function renderString(value: unknown, placeholder = REF): string {
  if (typeof value === 'string') return value;
  const parts = resolvePath(value, ['Fn::Join', '1']);
  return Array.isArray(parts)
    ? parts.map((part) => (typeof part === 'string' ? part : placeholder)).join('')
    : placeholder;
}

/** The deployed stage URL as `renderString` shows it: API id and URL suffix are references, the stage name is literal. */
export const RENDERED_STAGE_URL = `https://${REF}.execute-api.${TEST_REGION}.${REF}/prod/`;
/** The server's base URL as `renderString` shows it: the distribution's `DomainName` attribute, no path. */
export const RENDERED_BASE_URL = `https://${REF}`;

/** Every two-part `Fn::GetAtt` anywhere in `node`, as `<logical id>.<attribute>`. */
export function collectGetAttTargets(node: unknown): string[] {
  const getAtts = JSON.stringify(node ?? null).matchAll(/"Fn::GetAtt":\["([^"]+)","([^"]+)"\]/g);
  return [...getAtts].map(([, logicalId, attribute]) => `${logicalId}.${attribute}`);
}

/** The one distribution's logical id and its `DistributionConfig`. */
export function extractDistribution(template: Template): { distributionId: string; config: unknown } {
  const distributionId = soleLogicalId(template, 'AWS::CloudFront::Distribution');
  return {
    distributionId,
    config: resolvePath(soleResourceProperties(template, 'AWS::CloudFront::Distribution'), ['DistributionConfig']),
  };
}

/** The API resource with path part `pathPart` directly under the REST API's root (its parent is `RootResourceId`, not a `Ref`). */
export function findTopLevelApiResourceId(template: Template, pathPart: string): string {
  const resources = template.findResources('AWS::ApiGateway::Resource');
  return Object.entries(resources).find(([, resource]) =>
    resolveString(resource, ['Properties', 'PathPart']) === pathPart
    && resolveString(resource, ['Properties', 'ParentId', 'Fn::GetAtt', '1']) === 'RootResourceId')?.[0] ?? '';
}

function soleResourceProperties(template: Template, resourceType: string): unknown {
  return resolvePath(Object.values(template.findResources(resourceType))[0], ['Properties']);
}

export interface BrandingCustomResource {
  clientRef: unknown;
  theme: Record<string, unknown>;
  logoLightBase64: string;
  logoDarkBase64: string;
}

/**
 * The one managed-login branding custom resource: the client it themes and
 * the properties the handler patches onto Cognito's default style. The
 * construct seeds the default and recolours it at deploy time via its own
 * Lambda, so this is a `CloudFormation::CustomResource`, not a native
 * `AWS::Cognito::ManagedLoginBranding`.
 */
export function extractBrandingCustomResource(template: Template): BrandingCustomResource {
  const resources = template.findResources('AWS::CloudFormation::CustomResource');
  const props = Object.values(resources)
    .map((resource) => resolvePath(resource, ['Properties']))
    .find((candidate) => resolvePath(candidate, ['theme']) !== undefined);
  const theme: unknown = JSON.parse(resolveString(props, ['theme']) || '{}');
  return {
    clientRef: resolvePath(props, ['clientId']),
    theme: (theme && typeof theme === 'object' ? theme : {}) as Record<string, unknown>,
    logoLightBase64: resolveString(props, ['logoLightBase64']),
    logoDarkBase64: resolveString(props, ['logoDarkBase64']),
  };
}

/** The IAM actions granted to the branding handler Lambda's role, sorted. */
export function extractBrandingHandlerActions(template: Template): string[] {
  const roleId = findFunctionRoleLogicalId(template, 'CitationAnalysis-McpBrandingHandler');
  return allowStatementsOfRole(template, roleId)
    .flatMap((statement) => statementActions(statement))
    .filter((action) => action.startsWith('cognito-idp:'))
    .sort((a, b) => a.localeCompare(b));
}

/** The inline Python of the branding handler Lambda, as synthesized. */
export function extractBrandingHandlerCode(template: Template): string {
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: 'CitationAnalysis-McpBrandingHandler' },
  });
  return resolveString(functions[Object.keys(functions)[0] ?? ''], ['Properties', 'Code', 'ZipFile']);
}

/** `ScopeName`s of the one resource server, in declaration order. */
export function extractResourceServerScopeNames(template: Template): string[] {
  const scopes = resolvePath(soleResourceProperties(template, 'AWS::Cognito::UserPoolResourceServer'), ['Scopes']);
  return (Array.isArray(scopes) ? scopes : []).map((scope) => resolveString(scope, ['ScopeName']));
}

/**
 * The client's `AllowedOAuthScopes` as Cognito writes them into the access
 * token: a resource-server scope is synthesized as `<Ref server>/<scope>`,
 * and the server's `Ref` is its identifier, itself rendered by `renderString`
 * (the identifier is the MCP endpoint URL, a deploy-time value).
 */
export function extractClientOAuthScopes(template: Template): string[] {
  const identifier = renderString(resolvePath(
    soleResourceProperties(template, 'AWS::Cognito::UserPoolResourceServer'),
    ['Identifier']
  ));
  const scopes = resolvePath(soleResourceProperties(template, 'AWS::Cognito::UserPoolClient'), ['AllowedOAuthScopes']);
  return (Array.isArray(scopes) ? scopes : []).map((scope) => renderString(scope, identifier));
}

/** `AuthorizationScopes` of every method on the API resource, keyed by HTTP verb. */
export function extractAuthorizationScopesByVerb(template: Template, resourceId: string): Record<string, unknown> {
  const methods = template.findResources('AWS::ApiGateway::Method', { Properties: { ResourceId: { Ref: resourceId } } });
  return Object.fromEntries(Object.values(methods).map((method) => [
    resolveString(method, ['Properties', 'HttpMethod']),
    resolvePath(method, ['Properties', 'AuthorizationScopes']),
  ]));
}

/** The MCP function's environment with every value rendered by `renderString`. */
export function extractRenderedEnvVars(template: Template): Record<string, string> {
  return Object.fromEntries(
    Object.entries(extractLambdaEnvVars(template, MCP_FUNCTION_NAME)).map(([name, value]) => [name, renderString(value)])
  );
}

/**
 * What the MCP role's `lambda:InvokeFunction` statements name: the logical id
 * of each function ARN, or the raw entry (for example `*`) when it is not one.
 */
/** The `Resource` entries of the MCP function role's statements allowing `action`, each `Fn::GetAtt` reduced to its logical id. */
export function extractAllowedResourceIds(template: Template, action: string): unknown[] {
  const roleId = findFunctionRoleLogicalId(template, MCP_FUNCTION_NAME);
  return allowStatementsOfRole(template, roleId)
    .filter((statement) => statementActions(statement).includes(action))
    .flatMap((statement): unknown[] => {
      const resource = resolvePath(statement, ['Resource']);
      return Array.isArray(resource) ? resource : [resource];
    })
    .map((resource) => resolvePath(resource, ['Fn::GetAtt', '0']) ?? resource);
}

export function extractInvocableFunctionIds(template: Template): unknown[] {
  return extractAllowedResourceIds(template, 'lambda:InvokeFunction');
}

/**
 * The construct's `Mcp*` outputs, values rendered, keyed by `OutputKey`. The
 * construct overrides its logical ids to plain names; the REST API's own
 * `Endpoint` output keeps CDK's hashed id and is left out.
 */
export function extractMcpOutputs(template: Template): Record<string, string> {
  return Object.fromEntries(
    Object.entries(template.findOutputs('*'))
      .filter(([key]) => /^Mcp[A-Za-z]+$/.test(key) && !/[0-9A-F]{8}$/.test(key))
      .map(([key, output]) => [key, renderString(resolvePath(output, ['Value']))])
  );
}
