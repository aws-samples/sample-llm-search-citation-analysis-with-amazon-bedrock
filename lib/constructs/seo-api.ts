import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { API_CORS_PREFLIGHT, addCorsGatewayResponses } from './api-cors';
import { cognitoMethodOptions } from './api-auth';
import { API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS, pythonFunction } from './api-functions';
import { shareOneApiPermission } from './permissions';
import { lambdaSourceCode } from './python-layer';

/**
 * The SEO REST API (`CitationAnalysis-SeoApi`): every `/api/seo/...` route,
 * one proxy-integrated router Lambda (`lambda/seo/seo-router.py`) behind a
 * Cognito authorizer on the dashboard's user pool.
 *
 * Its own API rather than paths on the main one: the main stack owns the main
 * API's deployment and stage, so methods added from another stack would only
 * be served by whichever stack deployed last (the main stack was also then at
 * CloudFormation's 500-resource limit). The authorizer sets no authorization
 * scopes, so it accepts the dashboard's ID token (an access token without
 * custom scopes would be refused by a scoped authorizer, the MCP one).
 */

/** The router's name; the MCP stack invokes it by this name (router key `seo`). */
export const SEO_ROUTER_FUNCTION_NAME = 'CitationAnalysis-SeoRouter';

/**
 * Stage throttle: below the main API's 100/200, since most SEO routes are paid
 * DataForSEO calls. It is the API's only limit. There is no usage plan: a plan's
 * throttle and quota apply only to requests carrying an API key, and no SEO
 * method requires one (callers sign in with Cognito). The paid routes are open
 * to every signed-in user, like keyword research and Content Studio on the
 * main API, because there are no spend caps by design.
 */
const STAGE_RATE_LIMIT = 20;
const STAGE_BURST_LIMIT = 40;

/** Routes of the router: path below `/api/seo` (may hold `{param}` segments) and its methods. */
export type SeoRoutes = readonly (readonly [path: string, methods: readonly string[]])[];

/** The routes every SEO stack serves; each feature construct adds its own with `SeoApi.addRoutes`. */
const SEO_ROUTES: SeoRoutes = [
  ['keywords/research', ['POST']],
  ['keywords/metrics', ['POST']],
  ['keywords/metrics/lookup', ['POST']],
  ['serp', ['POST']],
  ['account', ['GET']],
  ['daily-calls', ['GET']],
  ['seo-geo', ['GET']],
];

export interface SeoApiProps {
  readonly userPool: cognito.IUserPool;
  /** The SEO stack's own shared layer (`shared.*` modules). */
  readonly sharedLayer: lambda.ILayerVersion;
  /** The router's environment (table, bucket and secret names). */
  readonly environment: Record<string, string>;
  /** Value of the gateway responses' `Access-Control-Allow-Origin`: the CloudFront origin, or '*' in dev mode. */
  readonly allowOrigin: string;
}

export class SeoApi extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly routerFunction: lambda.Function;
  private readonly seoResource: apigateway.IResource;
  private readonly methodOptions: apigateway.MethodOptions;
  private readonly integration: apigateway.LambdaIntegration;

  constructor(scope: Construct, id: string, props: SeoApiProps) {
    super(scope, id);

    this.api = new apigateway.RestApi(this, 'RestApi', {
      restApiName: 'CitationAnalysis-SeoApi',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: STAGE_RATE_LIMIT,
        throttlingBurstLimit: STAGE_BURST_LIMIT,
        // Request and response bodies stay out of CloudWatch (see the main API).
        dataTraceEnabled: false,
      },
      defaultCorsPreflightOptions: API_CORS_PREFLIGHT,
      description: 'SEO API for the Citation Analysis dashboard (DataForSEO keyword data, SERPs, SEO vs GEO)',
      // The main API's stack owns the account-level CloudWatch role.
      cloudWatchRole: false,
    });

    this.routerFunction = pythonFunction(this, 'Router', {
      functionName: SEO_ROUTER_FUNCTION_NAME,
      description: 'SEO API router: keyword research and metrics, SERPs, DataForSEO account, SEO vs GEO',
      handler: 'seo-router.handler',
      code: lambdaSourceCode('seo'),
      layers: [props.sharedLayer],
      timeout: cdk.Duration.seconds(API_GATEWAY_MAX_INTEGRATION_TIMEOUT_SECONDS),
      memorySize: 512,
      environment: props.environment,
    }, cdk.RemovalPolicy.DESTROY);

    this.methodOptions = cognitoMethodOptions(this, props.userPool, 'CitationAnalysis-SeoAuthorizer');
    this.integration = new apigateway.LambdaIntegration(this.routerFunction, { proxy: true });
    this.seoResource = this.api.root.addResource('api').addResource('seo');
    this.addRoutes(SEO_ROUTES);
    shareOneApiPermission(this, this.api, [this.routerFunction]);
    addCorsGatewayResponses(this.api, props.allowOrigin);
  }

  /**
   * Serve `routes` (paths below `/api/seo`) from the router, every one behind
   * the Cognito authorizer (no public route), each a proxy integration.
   */
  public addRoutes(routes: SeoRoutes): void {
    for (const [routePath, methods] of routes) {
      const resource = this.seoResource.resourceForPath(routePath);
      for (const method of methods) {
        resource.addMethod(method, this.integration, this.methodOptions);
      }
    }
  }
}
