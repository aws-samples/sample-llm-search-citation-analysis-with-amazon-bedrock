import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { McpState } from './mcp-state';
import { lambdaSourceCode } from './python-layer';

/**
 * The MCP (Model Context Protocol) server: one Lambda behind `POST /mcp` on its
 * own REST API that exposes the Citation Analysis API as tools to AI
 * assistants, protected as an OAuth 2.1 resource (RFC 9728) by the existing
 * Cognito user pool. It has its own API (and lives in its own stack) because
 * the main API sits at CloudFormation's 500-resource limit.
 *
 * Cognito is the authorization server. This construct adds what the pool is
 * missing for that role: a resource server whose custom scopes end up in the
 * access token, a managed-login domain so clients have a browser login page,
 * and a public (PKCE, no secret) app client for MCP clients. API Gateway's
 * Cognito authorizer checks the signature, expiry and scopes of the bearer
 * token; `lambda/mcp/handler.py` then checks issuer, client and audience and
 * calls the API router Lambdas with the caller's identity in the event.
 *
 * Discovery does not point clients at Cognito's own metadata: it omits
 * `code_challenge_methods_supported`, and MCP clients must then refuse the
 * server (Claude Code and the ChatGPT connector do). The protected resource
 * metadata names the stage URL as the authorization server instead, and the
 * API serves a complete metadata document for it at
 * `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server`,
 * whose endpoints are the managed-login domain's. Tokens are still Cognito's.
 *
 * The resource server's identifier is the MCP endpoint URL itself, so the
 * access-token scopes read `<McpUrl>/read` and so on. MCP clients send the
 * endpoint as the RFC 8707 `resource` parameter (Kiro does, checked 7 October
 * 2026), and Cognito then requires the requested custom scopes to belong to a
 * resource server with exactly that identifier; a short identifier such as
 * `geo` is refused with "custom scopes requested for resource-binding must be
 * assigned to the resource being requested".
 */

interface McpScope {
  readonly name: string;
  readonly description: string;
}

const MCP_SCOPES: readonly McpScope[] = [
  { name: 'read', description: 'Read keywords, groups, brand configuration, visibility and reports' },
  { name: 'write', description: 'Create and update keywords and groups; start keyword research and Content Studio briefs' },
  { name: 'run', description: 'Start analysis runs (admin)' },
];

const FUNCTION_NAME = 'CitationAnalysis-Mcp';

/**
 * Every MCP call fans out to one or more API router Lambdas, so this cap also
 * bounds how many router invocations an assistant can put in flight at once.
 */
const RESERVED_CONCURRENCY = 10;

/** API Gateway integrations time out at 29 s; the function must finish first. */
const API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS = 29;

/** Stage throttle: assistants retry in loops; the per-caller limit in the Lambda is the finer control. */
const STAGE_RATE_LIMIT = 20;
const STAGE_BURST_LIMIT = 40;

const MCP_PATH = 'mcp';
const WELL_KNOWN_PATH = '.well-known';
const PROTECTED_RESOURCE_METADATA_PATH = 'oauth-protected-resource';
/**
 * Where clients look for the authorization server metadata of the issuer
 * `<stage URL>`: appended to it, because the stage is a path segment and the
 * RFC 8414 path-inserted location falls outside the API (see
 * `AUTHORIZATION_SERVER_METADATA_PATHS` in `lambda/mcp/auth.py`).
 */
const AUTHORIZATION_SERVER_METADATA_PATHS = ['openid-configuration', 'oauth-authorization-server'];

/**
 * `api.url` without its trailing slash and without the dependency cycle.
 * `api.url` is a `Ref` to the
 * deployment stage; the stage depends on the deployment, the deployment on the
 * methods and the methods on this function, so the function's environment
 * cannot name the stage. The REST API id and the stage's configured name are
 * known before any method exists and resolve to the same URL. Without the
 * slash it is also the authorization server issuer, which clients compare
 * character by character with the PRM's `authorization_servers` entry.
 */
function stageUrl(api: apigateway.RestApi): string {
  const stage = api.deploymentStage.node.defaultChild as apigateway.CfnStage;
  const { region, urlSuffix } = cdk.Stack.of(api);
  // `Stage` always names its CfnStage; 'prod' is CDK's own default when it does not.
  return `https://${api.restApiId}.execute-api.${region}.${urlSuffix}/${stage.stageName ?? 'prod'}`;
}

/** The Cognito managed-login domain of `domainPrefix`, which serves `/oauth2/authorize`, `/oauth2/token` and `/oauth2/revoke`. */
function hostedLoginUrl(scope: Construct, domainPrefix: string): string {
  return `https://${domainPrefix}.auth.${cdk.Stack.of(scope).region}.amazoncognito.com`;
}

/**
 * A CDK context value that is a list of strings: a JSON array or a comma-separated
 * string (`-c mcpRedirectUris='["https://…"]'` or `-c mcpRedirectUris=https://a,https://b`).
 * Blank entries are dropped; an absent or empty value gives `fallback`.
 */
export function readMcpContextList(scope: Construct, key: string, fallback: string[]): string[] {
  const raw: unknown = scope.node.tryGetContext(key);
  const values = contextEntries(raw).map((entry) => entry.trim()).filter((entry) => entry !== '');
  return values.length > 0 ? values : fallback;
}

function contextEntries(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === 'string');
  if (typeof raw === 'string') return raw.split(',');
  return [];
}

/**
 * What the server builds on from the main stack: the user pool it is an OAuth
 * resource of and the API router Lambdas its tools call. Only values that never
 * change for the life of a resource cross the stack boundary (pool id,
 * function names and ARNs): CloudFormation refuses to update an exported value
 * another stack imports, so a layer version, whose ARN changes with every
 * rebuild, is built by the MCP stack itself (see `python-layer.ts`).
 */
export interface McpServerInputs {
  readonly userPool: cognito.IUserPool;
  /** API router Lambdas by router name (`keyword-mgmt`, `config-mgmt`, ...); the server may invoke exactly these. */
  readonly apiFunctions: Record<string, lambda.IFunction>;
}

export interface McpServerProps extends McpServerInputs {
  /** The shared Python layer (`shared.*` modules), owned by the same stack as the server. */
  readonly sharedLayer: lambda.ILayerVersion;
  /** OAuth redirect URIs of the MCP clients (CDK context `mcpRedirectUris`). */
  readonly redirectUris: string[];
  /** Catalogue operations promoted to direct tools (CDK context `mcpPinnedTools`). */
  readonly pinnedTools?: string[];
  /** Cognito domain prefix, e.g. `citation-analysis-<account>`. */
  readonly domainPrefix: string;
  /** Spend-guard state table and per-caller limits (`McpState`). */
  readonly state: McpState;
}

export class McpServer extends Construct {
  /** The MCP server's own REST API (stage `prod`). */
  public readonly api: apigateway.RestApi;
  /**
   * `<stage URL>/.well-known/oauth-protected-resource`, advertised by the API's
   * `UNAUTHORIZED` gateway response in a `WWW-Authenticate: Bearer
   * resource_metadata="<url>"` header so clients discover the authorization
   * server from a 401.
   */
  public readonly resourceMetadataUrl: string;

  constructor(scope: Construct, id: string, props: McpServerProps) {
    super(scope, id);

    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'CitationAnalysis-McpApi',
      description: 'MCP server for AI assistants (OAuth 2.1 resource of the Citation Analysis user pool)',
      // The account-level CloudWatch role is owned by the main API's stack.
      cloudWatchRole: false,
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: STAGE_RATE_LIMIT,
        throttlingBurstLimit: STAGE_BURST_LIMIT,
      },
    });
    const apiUrl = stageUrl(this.api);
    // Also the resource server identifier and the `aud` the Lambda expects; one value, three roles.
    const resourceUrl = `${apiUrl}/${MCP_PATH}`;
    this.resourceMetadataUrl = `${apiUrl}/${WELL_KNOWN_PATH}/${PROTECTED_RESOURCE_METADATA_PATH}`;
    // RFC 9728: a 401 tells the client where the protected resource metadata is.
    this.api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      responseHeaders: { 'WWW-Authenticate': `'Bearer resource_metadata="${this.resourceMetadataUrl}"'` },
    });

    const scopes = MCP_SCOPES.map((scope) => new cognito.ResourceServerScope({
      scopeName: scope.name,
      scopeDescription: scope.description,
    }));
    const resourceServer = new cognito.UserPoolResourceServer(this, 'ResourceServer', {
      userPool: props.userPool,
      identifier: resourceUrl,
      userPoolResourceServerName: 'Citation Analysis MCP',
      scopes,
    });

    // The pool had no domain before this construct (checked 7 October 2026);
    // a pool can hold only one Cognito-prefix domain.
    const domain = new cognito.UserPoolDomain(this, 'Domain', {
      userPool: props.userPool,
      cognitoDomain: { domainPrefix: props.domainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    const client = this.oauthClient(props, resourceServer, scopes);

    // Managed login v2 refuses to render the login page for a client without a
    // branding style; the Cognito defaults are enough for a login form.
    const branding = new cognito.CfnManagedLoginBranding(this, 'Branding', {
      userPoolId: props.userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    branding.node.addDependency(domain);

    const serverFunction = this.serverFunction(props, client, { resourceUrl, authorizationServerUrl: apiUrl });
    this.addRoutes(props, serverFunction, resourceUrl);
    this.addOutputs(props.domainPrefix, client, resourceUrl);
  }

  /**
   * The `mcp` app client: authorization code grant only (PKCE, no secret, no
   * implicit grant), the three resource-server scopes plus `openid` (still
   * allowed for clients that ask, though the metadata no longer offers it). Access and
   * ID tokens live one hour like the dashboard client's; the refresh token
   * lives 90 days so an assistant integration is not re-authorised weekly.
   */
  private oauthClient(
    props: McpServerProps,
    resourceServer: cognito.IUserPoolResourceServer,
    scopes: cognito.ResourceServerScope[]
  ): cognito.UserPoolClient {
    const tokenValidity = cdk.Duration.hours(1);
    return new cognito.UserPoolClient(this, 'Client', {
      userPool: props.userPool,
      userPoolClientName: 'mcp',
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          ...scopes.map((scope) => cognito.OAuthScope.resourceServer(resourceServer, scope)),
        ],
        callbackUrls: props.redirectUris,
      },
      accessTokenValidity: tokenValidity,
      idTokenValidity: tokenValidity,
      refreshTokenValidity: cdk.Duration.days(90),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
    });
  }

  /**
   * `CitationAnalysis-Mcp` on the shared layer (x86_64, the layer's
   * architecture), with the contract's environment and permission to invoke
   * exactly the API router functions.
   */
  private serverFunction(
    props: McpServerProps,
    client: cognito.UserPoolClient,
    urls: { resourceUrl: string; authorizationServerUrl: string }
  ): lambda.Function {
    const stack = cdk.Stack.of(this);
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${FUNCTION_NAME}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const routerFunctionNames = Object.fromEntries(
      Object.entries(props.apiFunctions).map(([router, routerFunction]) => [router, routerFunction.functionName])
    );

    const serverFunction = new lambda.Function(this, 'Function', {
      functionName: FUNCTION_NAME,
      description: 'MCP server: OAuth-protected tools over the Citation Analysis API',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambdaSourceCode('mcp'),
      layers: [props.sharedLayer],
      memorySize: 512,
      timeout: cdk.Duration.seconds(API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS),
      reservedConcurrentExecutions: RESERVED_CONCURRENCY,
      logGroup,
      environment: {
        MCP_ISSUER: `https://cognito-idp.${stack.region}.amazonaws.com/${props.userPool.userPoolId}`,
        MCP_CLIENT_ID: client.userPoolClientId,
        MCP_RESOURCE_URL: urls.resourceUrl,
        MCP_RESOURCE_METADATA_URL: this.resourceMetadataUrl,
        MCP_AUTHORIZATION_SERVER: urls.authorizationServerUrl,
        MCP_HOSTED_LOGIN_URL: hostedLoginUrl(this, props.domainPrefix),
        MCP_API_FUNCTIONS: stack.toJsonString(routerFunctionNames),
        MCP_PINNED_TOOLS: (props.pinnedTools ?? []).join(','),
      },
    });
    serverFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: Object.values(props.apiFunctions).map((routerFunction) => routerFunction.functionArn),
    }));
    props.state.grantTo(serverFunction);
    return serverFunction;
  }

  /**
   * `POST /mcp` and `GET /mcp` behind the Cognito authorizer with the MCP
   * scopes (so the authorizer validates an access token, not an ID token), and
   * the public discovery documents.
   */
  private addRoutes(props: McpServerProps, serverFunction: lambda.IFunction, resourceUrl: string): void {
    const integration = new apigateway.LambdaIntegration(serverFunction, { proxy: true });
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: 'CitationAnalysis-McpAuthorizer',
      identitySource: 'method.request.header.Authorization',
    });
    const protectedRoute: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: MCP_SCOPES.map((scope) => `${resourceUrl}/${scope.name}`),
    };

    const mcpResource = this.api.root.addResource(MCP_PATH);
    mcpResource.addMethod('POST', integration, protectedRoute);
    // Same authorizer, so an anonymous GET is refused by API Gateway; an
    // authenticated one reaches the Lambda, which answers 405 (no SSE stream).
    mcpResource.addMethod('GET', integration, protectedRoute);

    // Public by design: clients fetch these discovery documents before they
    // have a token, and they carry nothing but the authorization server's
    // location and capabilities.
    const wellKnown = this.api.root.addResource(WELL_KNOWN_PATH);
    for (const path of [PROTECTED_RESOURCE_METADATA_PATH, ...AUTHORIZATION_SERVER_METADATA_PATHS]) {
      // NOSONAR: the discovery documents must be readable without authentication
      wellKnown.addResource(path).addMethod('GET', integration, { authorizationType: apigateway.AuthorizationType.NONE }); // NOSONAR
    }
  }

  /** Outputs with stable `OutputKey`s (no construct-path hash), so `describe-stacks` queries can name them. */
  private addOutputs(domainPrefix: string, client: cognito.UserPoolClient, resourceUrl: string): void {
    const loginUrl = hostedLoginUrl(this, domainPrefix);
    const outputs: Record<string, [value: string, description: string]> = {
      McpUrl: [resourceUrl, 'MCP server endpoint (Streamable HTTP, JSON responses)'],
      McpClientId: [client.userPoolClientId, 'Cognito app client for MCP clients (public, PKCE)'],
      McpAuthorizeUrl: [`${loginUrl}/oauth2/authorize`, 'OAuth 2.0 authorization endpoint'],
      McpTokenUrl: [`${loginUrl}/oauth2/token`, 'OAuth 2.0 token endpoint'],
      McpResourceMetadataUrl: [this.resourceMetadataUrl, 'RFC 9728 protected resource metadata'],
    };
    for (const [id, [value, description]] of Object.entries(outputs)) {
      new cdk.CfnOutput(this, id, { value, description }).overrideLogicalId(id);
    }
  }
}
