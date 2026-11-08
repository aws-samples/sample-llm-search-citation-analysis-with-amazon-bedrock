import {
  describe, it, expect
} from 'vitest';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
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
  RENDERED_BASE_URL,
  RENDERED_STAGE_URL,
  TEST_DOMAIN_PREFIX,
  TEST_REDIRECT_URIS,
  TEST_REGION,
  collectGetAttTargets,
  extractAuthorizationScopesByVerb,
  extractBrandingCustomResource,
  extractBrandingHandlerActions,
  extractBrandingHandlerCode,
  extractClientOAuthScopes,
  extractDistribution,
  extractAllowedResourceIds,
  extractInvocableFunctionIds,
  extractMcpOutputs,
  extractMcpTemplateIds,
  extractRenderedEnvVars,
  extractResourceServerScopeNames,
  findTopLevelApiResourceId,
  renderString,
  synthesizeMcpServer,
} from './mcp-server-fixtures';

/** The MCP endpoint as `renderString` shows it; also the resource server identifier and the scope prefix. */
const RENDERED_MCP_URL = `${RENDERED_BASE_URL}/mcp`;
const MCP_SCOPES = ['read', 'write', 'run'].map((scope) => `${RENDERED_MCP_URL}/${scope}`);
const ONE_HOUR_IN_MINUTES = 60;
const NINETY_DAYS_IN_MINUTES = 90 * 24 * 60;
const RESERVED_CONCURRENCY = 10;
const HOSTED_LOGIN_URL = `https://${TEST_DOMAIN_PREFIX}.auth.${TEST_REGION}.amazoncognito.com`;
/** RFC 9728 §3.1: the well-known segment goes before the resource's path `/mcp`. */
const RENDERED_METADATA_URL = `${RENDERED_BASE_URL}/.well-known/oauth-protected-resource/mcp`;
const AUTHORIZATION_SERVER_METADATA_PATHS = ['openid-configuration', 'oauth-authorization-server'];

const { template, resourceMetadataUrl } = synthesizeMcpServer();
const ids = extractMcpTemplateIds(template);
const clientProps = extractUserPoolClientProps(template);
const mcpResourceId = findTopLevelApiResourceId(template, 'mcp');
const wellKnownId = findApiResourceId(template, '.well-known');
const protectedResourceMetadataId = findApiResourceId(template, 'oauth-protected-resource', wellKnownId);
const { distributionId, config: distributionConfig } = extractDistribution(template);
const defaultBehavior = resolvePath(distributionConfig, ['DefaultCacheBehavior']);
const origin = resolvePath(distributionConfig, ['Origins', '0']);
const distributionDomain = `${distributionId}.DomainName`;

describe('CloudFront edge', () => {
  it('forwards to the API execute-api host with the stage as origin path, over HTTPS only', () => {
    expect(renderString(resolvePath(origin, ['DomainName']))).toBe(`${REF}.execute-api.${TEST_REGION}.${REF}`);
    expect(collectRefTargets(resolvePath(origin, ['DomainName']))).toStrictEqual([ids.restApiId, 'AWS::URLSuffix']);
    expect(resolvePath(origin, ['OriginPath'])).toBe('/prod');
    expect(resolvePath(origin, ['CustomOriginConfig', 'OriginProtocolPolicy'])).toBe('https-only');
  });

  it('passes every method through uncached', () => {
    expect(resolvePath(defaultBehavior, ['AllowedMethods'])).toStrictEqual(['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE']);
    expect(resolvePath(defaultBehavior, ['CachePolicyId'])).toBe(cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId);
  });

  it('forwards all viewer headers but Host, so Authorization reaches API Gateway and its Host check passes', () => {
    expect(resolvePath(defaultBehavior, ['OriginRequestPolicyId']))
      .toBe(cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId);
  });

  it('accepts HTTPS viewers only, from the cheapest price class', () => {
    expect(resolvePath(defaultBehavior, ['ViewerProtocolPolicy'])).toBe('https-only');
    expect(resolvePath(distributionConfig, ['PriceClass'])).toBe('PriceClass_100');
  });
});

describe('Cognito resource server', () => {
  it('is identified by the MCP endpoint URL, so RFC 8707 resource binding to that URL is accepted', () => {
    const servers = Object.values(template.findResources('AWS::Cognito::UserPoolResourceServer'));

    expect(servers.map((server) => renderString(resolvePath(server, ['Properties', 'Identifier'])))).toStrictEqual([RENDERED_MCP_URL]);
  });

  it('takes its identifier host from the CloudFront distribution', () => {
    const servers = Object.values(template.findResources('AWS::Cognito::UserPoolResourceServer'));

    expect(collectGetAttTargets(resolvePath(servers[0], ['Properties', 'Identifier']))).toStrictEqual([distributionDomain]);
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

  it('themes the mcp client managed-login pages instead of leaving Cognito defaults', () => {
    const branding = extractBrandingCustomResource(template);

    expect(branding.clientRef).toStrictEqual({ Ref: ids.clientId });
  });

  it('themes managed login to the dashboard login palette (gray-900 header, white surface, blue-600 links)', () => {
    const { theme } = extractBrandingCustomResource(template);

    expect(theme.header).toBe('#111827');
    expect(theme.lightSurface).toBe('#ffffff');
    expect(theme.link).toBe('#2563eb');
    expect(theme.radius).toBe(8);
  });

  it('ships a light and a dark logo asset for the managed-login pages', () => {
    const branding = extractBrandingCustomResource(template);

    expect(branding.logoLightBase64.length).toBeGreaterThan(0);
    expect(branding.logoDarkBase64.length).toBeGreaterThan(0);
    expect(branding.logoLightBase64).not.toBe(branding.logoDarkBase64);
  });

  it('themes a branding that already exists for the client instead of failing the deploy', () => {
    // Cognito answers CreateManagedLoginBranding with this exception when the
    // client already has a style (console-made, or a re-run); the handler must
    // catch exactly it and fall through to describe/patch (2.37.2 deploy failure).
    const code = extractBrandingHandlerCode(template);

    expect(code).toContain('except cognito.exceptions.ManagedLoginBrandingExistsException');
    expect(code).not.toContain('except cognito.exceptions.InvalidParameterException');
  });

  it('hands Cognito the decoded logo bytes, not the base64 text the properties carry', () => {
    // boto3 base64-encodes `Bytes` itself; passing the property string through
    // made Cognito reject every asset as text/plain (2.37.2 deploy failure).
    const code = extractBrandingHandlerCode(template);

    expect(code).toContain("base64.b64decode(properties['logoLightBase64'])");
    expect(code).toContain("base64.b64decode(properties['logoDarkBase64'])");
  });

  it('grants the branding handler only the three managed-login branding actions', () => {
    expect(extractBrandingHandlerActions(template)).toStrictEqual([
      'cognito-idp:CreateManagedLoginBranding',
      'cognito-idp:DescribeManagedLoginBrandingByClient',
      'cognito-idp:UpdateManagedLoginBranding',
    ]);
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

describe('Discovery routes', () => {
  // The PRM twice: at the RFC 9728 path-inserted location for the resource `/mcp`, and bare.
  const routes: [path: string, resourceId: string][] = [
    ['oauth-protected-resource', protectedResourceMetadataId],
    ['oauth-protected-resource/mcp', findApiResourceId(template, 'mcp', protectedResourceMetadataId)],
    ...AUTHORIZATION_SERVER_METADATA_PATHS.map((path): [string, string] => [path, findApiResourceId(template, path, wellKnownId)]),
  ];

  it.each(routes)(
    'serves GET /.well-known/%s from the MCP function without authentication or scopes',
    (_path, resourceId) => {
      const methods = extractApiMethods(template, resourceId);

      expect(methods.map((method) => `${method.httpMethod} ${method.authorizationType}`)).toStrictEqual(['GET NONE']);
      expect(unguardedVerbs(methods, ids.functionId).notIntegratedWithFunction).toStrictEqual([]);
      expect(extractAuthorizationScopesByVerb(template, resourceId)).toStrictEqual({ GET: undefined });
    }
  );
});

describe('Protected resource metadata route', () => {
  it('exposes the path-inserted metadata URL on the CloudFront host that its 401 response advertises', () => {
    expect(resourceMetadataUrl).toBe(RENDERED_METADATA_URL);
  });

  it('tells an anonymous caller where the protected resource metadata is (RFC 9728)', () => {
    const responses = template.findResources('AWS::ApiGateway::GatewayResponse', {
      Properties: { ResponseType: 'UNAUTHORIZED', StatusCode: '401' },
    });
    const header = resolvePath(Object.values(responses)[0], ['Properties', 'ResponseParameters', 'gatewayresponse.header.WWW-Authenticate']);

    expect(Object.keys(responses)).toHaveLength(1);
    expect(renderString(header)).toBe(`'Bearer resource_metadata="${RENDERED_METADATA_URL}"'`);
    expect(collectGetAttTargets(header)).toStrictEqual([distributionDomain]);
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
      MCP_USER_POOL_ID: REF,
      MCP_CLIENT_ID: REF,
      MCP_RESOURCE_URL: RENDERED_MCP_URL,
      MCP_RESOURCE_METADATA_URL: RENDERED_METADATA_URL,
      MCP_AUTHORIZATION_SERVER: RENDERED_BASE_URL,
      MCP_HOSTED_LOGIN_URL: HOSTED_LOGIN_URL,
      MCP_API_FUNCTIONS: `{"keyword-mgmt":"${REF}","config-mgmt":"${REF}"}`,
      MCP_PINNED_TOOLS: 'list_providers,get_dashboard_stats',
      MCP_STATE_TABLE: REF,
      MCP_LIMITS: '{"runsInFlight":1,"runsPerDay":5,"jobsPerDay":20,"maxRunKeywords":50}',
    });
  });

  it('names the router functions and the mcp client in its environment', () => {
    const envVars = extractLambdaEnvVars(template, MCP_FUNCTION_NAME);

    expect(collectRefTargets(envVars.MCP_API_FUNCTIONS)).toStrictEqual(ids.stubFunctionIds);
    expect(collectRefTargets(envVars.MCP_CLIENT_ID)).toStrictEqual([ids.clientId]);
  });

  it('takes the resource URL, the metadata URL and the issuer from the CloudFront distribution', () => {
    const envVars = extractLambdaEnvVars(template, MCP_FUNCTION_NAME);
    const urls = [envVars.MCP_RESOURCE_URL, envVars.MCP_RESOURCE_METADATA_URL, envVars.MCP_AUTHORIZATION_SERVER];

    expect(urls.map((url) => collectGetAttTargets(url))).toStrictEqual([[distributionDomain], [distributionDomain], [distributionDomain]]);
  });

  it('may invoke exactly the router functions', () => {
    expect(extractInvocableFunctionIds(template)).toStrictEqual(ids.stubFunctionIds);
  });

  it('may list the groups of a user of its own pool only, the source of every caller\'s groups', () => {
    expect(extractAllowedResourceIds(template, 'cognito-idp:AdminListGroupsForUser')).toStrictEqual([ids.userPoolId]);
  });
});

describe('Stack outputs', () => {
  it('publishes the endpoint, the client id, the OAuth endpoints, the metadata URL and the stage URL', () => {
    expect(extractMcpOutputs(template)).toStrictEqual({
      McpUrl: RENDERED_MCP_URL,
      McpClientId: REF,
      McpAuthorizeUrl: `${HOSTED_LOGIN_URL}/oauth2/authorize`,
      McpTokenUrl: `${HOSTED_LOGIN_URL}/oauth2/token`,
      McpResourceMetadataUrl: RENDERED_METADATA_URL,
      McpApiUrl: RENDERED_STAGE_URL.replace(/\/$/, ''),
    });
  });
});
