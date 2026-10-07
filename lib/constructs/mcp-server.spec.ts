import {
  describe, it, expect
} from 'vitest';
import {
  FULLY_GUARDED,
  collectRefTargets,
  extractApiMethods,
  extractLambdaEnvVars,
  extractLambdaLayerRefs,
  extractReservedConcurrency,
  extractUserPoolClientProps,
  findApiResourceId,
  resolvePath,
  sortedHttpMethods,
  tokenValidityMinutes,
  unguardedVerbs,
} from '../citation-analysis-stack-fixtures';
import {
  MCP_FUNCTION_NAME,
  REF,
  RENDERED_STAGE_URL,
  TEST_DOMAIN_PREFIX,
  TEST_REDIRECT_URIS,
  TEST_REGION,
  extractAuthorizationScopesByVerb,
  extractClientOAuthScopes,
  extractInvocableFunctionIds,
  extractMcpOutputs,
  extractMcpTemplateIds,
  extractRenderedEnvVars,
  extractResourceServerScopeNames,
  renderString,
  synthesizeMcpServer,
} from './mcp-server-fixtures';

/** The MCP endpoint as `renderString` shows it; also the resource server identifier and the scope prefix. */
const RENDERED_MCP_URL = `${RENDERED_STAGE_URL}mcp`;
const MCP_SCOPES = ['read', 'write', 'run'].map((scope) => `${RENDERED_MCP_URL}/${scope}`);
const ONE_HOUR_IN_MINUTES = 60;
const NINETY_DAYS_IN_MINUTES = 90 * 24 * 60;
const RESERVED_CONCURRENCY = 10;
const HOSTED_LOGIN_URL = `https://${TEST_DOMAIN_PREFIX}.auth.${TEST_REGION}.amazoncognito.com`;
const METADATA_PATH = '.well-known/oauth-protected-resource';

const { template, resourceMetadataUrl } = synthesizeMcpServer();
const ids = extractMcpTemplateIds(template);
const clientProps = extractUserPoolClientProps(template);
const mcpResourceId = findApiResourceId(template, 'mcp');
const metadataResourceId = findApiResourceId(
  template, 'oauth-protected-resource', findApiResourceId(template, '.well-known')
);

describe('Cognito resource server', () => {
  it('is identified by the MCP endpoint URL, so RFC 8707 resource binding to that URL is accepted', () => {
    const servers = Object.values(template.findResources('AWS::Cognito::UserPoolResourceServer'));

    expect(servers.map((server) => renderString(resolvePath(server, ['Properties', 'Identifier'])))).toStrictEqual([RENDERED_MCP_URL]);
  });

  it('declares the read, write and run scopes', () => {
    expect(extractResourceServerScopeNames(template)).toStrictEqual(['read', 'write', 'run']);
  });
});

describe('Managed login', () => {
  it('creates the Cognito domain on managed login v2', () => {
    const domains = template.findResources('AWS::Cognito::UserPoolDomain', {
      Properties: { Domain: TEST_DOMAIN_PREFIX, ManagedLoginVersion: 2 },
    });

    expect(Object.keys(domains)).toHaveLength(1);
  });

  it('gives the mcp client the Cognito default branding so its login page renders', () => {
    const brandings = template.findResources('AWS::Cognito::ManagedLoginBranding', {
      Properties: { ClientId: { Ref: ids.clientId }, UseCognitoProvidedValues: true },
    });

    expect(Object.keys(brandings)).toHaveLength(1);
  });
});

describe('mcp app client', () => {
  it('is a public client using the authorization code grant only', () => {
    expect(clientProps.GenerateSecret).toBe(false);
    expect(clientProps.AllowedOAuthFlows).toStrictEqual(['code']);
    expect(clientProps.AllowedOAuthFlowsUserPoolClient).toBe(true);
    expect(clientProps.CallbackURLs).toStrictEqual(TEST_REDIRECT_URIS);
  });

  it('may request openid and the three endpoint-prefixed scopes', () => {
    expect(extractClientOAuthScopes(template)).toStrictEqual(['openid', ...MCP_SCOPES]);
  });

  it('limits access and ID tokens to one hour', () => {
    expect(tokenValidityMinutes(clientProps, 'Access')).toBe(ONE_HOUR_IN_MINUTES);
    expect(tokenValidityMinutes(clientProps, 'Id')).toBe(ONE_HOUR_IN_MINUTES);
  });

  it('lets refresh tokens live 90 days', () => {
    expect(clientProps.TokenValidityUnits).toStrictEqual({
      AccessToken: 'minutes',
      IdToken: 'minutes',
      RefreshToken: 'minutes',
    });
    expect(tokenValidityMinutes(clientProps, 'Refresh')).toBe(NINETY_DAYS_IN_MINUTES);
  });

  it('hides whether a user exists and supports token revocation', () => {
    expect(clientProps.PreventUserExistenceErrors).toBe('ENABLED');
    expect(clientProps.EnableTokenRevocation).toBe(true);
  });
});

describe('/mcp routes', () => {
  it('serves POST and GET /mcp from the MCP function behind the Cognito authorizer', () => {
    const methods = extractApiMethods(template, mcpResourceId);

    expect(sortedHttpMethods(methods)).toStrictEqual(['GET', 'POST']);
    expect(unguardedVerbs(methods, ids.functionId)).toStrictEqual(FULLY_GUARDED);
    expect(methods.map((method) => method.authorizerId)).toStrictEqual([ids.authorizerId, ids.authorizerId]);
  });

  it('requires one of the endpoint-prefixed scopes on both verbs so the authorizer validates access tokens', () => {
    const byVerb = extractAuthorizationScopesByVerb(template, mcpResourceId);
    const rendered = Object.fromEntries(Object.entries(byVerb).map(([verb, scopes]) => [
      verb, (Array.isArray(scopes) ? scopes : []).map((scope) => renderString(scope)),
    ]));

    expect(rendered).toStrictEqual({ POST: MCP_SCOPES, GET: MCP_SCOPES });
  });
});

describe('Protected resource metadata route', () => {
  it(`serves GET /${METADATA_PATH} from the MCP function without authentication`, () => {
    const methods = extractApiMethods(template, metadataResourceId);

    expect(methods.map((method) => `${method.httpMethod} ${method.authorizationType}`)).toStrictEqual(['GET NONE']);
    expect(unguardedVerbs(methods, ids.functionId).notIntegratedWithFunction).toStrictEqual([]);
    expect(extractAuthorizationScopesByVerb(template, metadataResourceId)).toStrictEqual({ GET: undefined });
  });

  it('exposes the metadata URL its 401 response advertises', () => {
    expect(resourceMetadataUrl).toBe(`${RENDERED_STAGE_URL}${METADATA_PATH}`);
  });

  it('tells an anonymous caller where the protected resource metadata is (RFC 9728)', () => {
    const responses = template.findResources('AWS::ApiGateway::GatewayResponse', {
      Properties: { ResponseType: 'UNAUTHORIZED', StatusCode: '401' },
    });

    expect(Object.keys(responses)).toHaveLength(1);
    expect(renderString(resolvePath(Object.values(responses)[0], ['Properties', 'ResponseParameters', 'gatewayresponse.header.WWW-Authenticate'])))
      .toBe(`'Bearer resource_metadata="${RENDERED_STAGE_URL}${METADATA_PATH}"'`);
  });

  it('throttles its own stage and leaves the account CloudWatch role to the main API', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: 'prod',
      MethodSettings: [{ HttpMethod: '*', ResourcePath: '/*', ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 }],
    });
    expect(template.findResources('AWS::ApiGateway::Account')).toStrictEqual({});
  });
});

describe('MCP function', () => {
  it('runs handler.handler on Python 3.12 with 512 MB inside the API Gateway integration limit', () => {
    const functions = template.findResources('AWS::Lambda::Function', {
      Properties: {
        FunctionName: MCP_FUNCTION_NAME,
        Runtime: 'python3.12',
        Handler: 'handler.handler',
        MemorySize: 512,
        Timeout: 29,
      },
    });

    expect(Object.keys(functions)).toStrictEqual([ids.functionId]);
  });

  it('reserves ten concurrent executions', () => {
    expect(extractReservedConcurrency(template, MCP_FUNCTION_NAME)).toBe(RESERVED_CONCURRENCY);
  });

  it('ships on the shared layer', () => {
    expect(extractLambdaLayerRefs(template, MCP_FUNCTION_NAME)).toStrictEqual([ids.sharedLayerId]);
  });

  it('receives every contract environment variable', () => {
    expect(extractRenderedEnvVars(template)).toStrictEqual({
      MCP_ISSUER: `https://cognito-idp.${TEST_REGION}.amazonaws.com/${REF}`,
      MCP_CLIENT_ID: REF,
      MCP_RESOURCE_URL: `${RENDERED_STAGE_URL}mcp`,
      MCP_RESOURCE_METADATA_URL: `${RENDERED_STAGE_URL}${METADATA_PATH}`,
      MCP_API_FUNCTIONS: `{"keyword-mgmt":"${REF}","config-mgmt":"${REF}"}`,
      MCP_PINNED_TOOLS: 'list_providers,get_dashboard_stats',
    });
  });

  it('names the router functions and the mcp client in its environment', () => {
    const envVars = extractLambdaEnvVars(template, MCP_FUNCTION_NAME);

    expect(collectRefTargets(envVars.MCP_API_FUNCTIONS)).toStrictEqual(ids.stubFunctionIds);
    expect(collectRefTargets(envVars.MCP_CLIENT_ID)).toStrictEqual([ids.clientId]);
  });

  it('may invoke exactly the router functions', () => {
    expect(extractInvocableFunctionIds(template)).toStrictEqual(ids.stubFunctionIds);
  });
});

describe('Stack outputs', () => {
  it('publishes the endpoint, the client id, the OAuth endpoints and the metadata URL', () => {
    expect(extractMcpOutputs(template)).toStrictEqual({
      McpUrl: `${RENDERED_STAGE_URL}mcp`,
      McpClientId: REF,
      McpAuthorizeUrl: `${HOSTED_LOGIN_URL}/oauth2/authorize`,
      McpTokenUrl: `${HOSTED_LOGIN_URL}/oauth2/token`,
      McpResourceMetadataUrl: `${RENDERED_STAGE_URL}${METADATA_PATH}`,
    });
  });
});
