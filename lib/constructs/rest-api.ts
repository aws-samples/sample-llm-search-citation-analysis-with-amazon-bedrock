import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { API_CORS_PREFLIGHT, addCorsGatewayResponses } from './api-cors';

/**
 * The Lambdas behind the dashboard REST API, by the key the route table uses.
 * Each has a fixed function name in the main stack, so its ARN never changes.
 */
export const DASHBOARD_API_FUNCTION_KEYS = [
  'health',
  'stats-insights',
  'citations-content',
  'keyword-mgmt',
  'config-mgmt',
  'execution-mgmt',
  'brand-mentions',
  'brand-config',
  'content-studio',
  'users',
  'persona-rankings',
  'self-reflection',
  'exports',
] as const;

export type DashboardApiFunctionKey = typeof DASHBOARD_API_FUNCTION_KEYS[number];

export type DashboardApiFunctions = Record<DashboardApiFunctionKey, lambda.IFunction>;

/**
 * The fixed function name of each API Lambda. The main stack names its
 * functions from this table and the API stack builds their ARNs from it, so
 * the API stack needs no cross-stack reference (export) to reach them.
 */
export const DASHBOARD_API_FUNCTION_NAMES: Readonly<Record<DashboardApiFunctionKey, string>> = {
  health: 'CitationAnalysis-API-Health',
  'stats-insights': 'CitationAnalysis-API-StatsInsights',
  'citations-content': 'CitationAnalysis-API-CitationsContent',
  'keyword-mgmt': 'CitationAnalysis-API-KeywordMgmt',
  'config-mgmt': 'CitationAnalysis-API-ConfigMgmt',
  'execution-mgmt': 'CitationAnalysis-API-ExecutionMgmt',
  'brand-mentions': 'CitationAnalysis-API-GetBrandMentions',
  'brand-config': 'CitationAnalysis-API-ManageBrandConfig',
  'content-studio': 'CitationAnalysis-API-ContentStudio',
  users: 'CitationAnalysis-API-ManageUsers',
  'persona-rankings': 'CitationAnalysis-API-GetPersonaRankings',
  'self-reflection': 'CitationAnalysis-API-SelfReflection',
  exports: 'CitationAnalysis-API-Exports',
};

/**
 * Routers that back many routes. Each gets ONE invoke permission for the
 * whole API (`execute-api:<api>/*`) instead of two per method (prod +
 * test-invoke): every route shares the Cognito authorizer and the function
 * does its own routing. Wildcard source ARNs are supported for execute-api.
 * The other functions keep CDK's per-method permissions.
 */
export const WILDCARD_PERMISSION_FUNCTION_KEYS: readonly DashboardApiFunctionKey[] = [
  'stats-insights',
  'citations-content',
  'keyword-mgmt',
  'config-mgmt',
  'execution-mgmt',
  'brand-config',
  'content-studio',
  'users',
];

export interface DashboardRestApiProps {
  /** The API Lambdas. Imported functions must skip CDK permissions for the wildcard keys (see `WILDCARD_PERMISSION_FUNCTION_KEYS`). */
  readonly functions: DashboardApiFunctions;
  readonly userPool: cognito.IUserPool;
  /** `https://<dashboard domain>`: the only origin auth and integration failures expose their status to. */
  readonly dashboardOrigin: string;
  /** `-c dev=true`: gateway responses allow every origin, so `localhost:5173` can read them. */
  readonly devMode: boolean;
}

type Route = (resource: apigateway.IResource, key: DashboardApiFunctionKey, ...httpMethods: string[]) => void;

/**
 * The dashboard REST API `CitationAnalysis-API`: every `/api/*` route, the
 * Cognito authorizer on every method except `GET /api/health`, CORS preflights,
 * gateway responses, the stage throttle and usage plan, and the invoke
 * permissions of the Lambdas behind it.
 */
export class DashboardRestApi extends Construct {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: DashboardRestApiProps) {
    super(scope, id);

    this.api = new apigateway.RestApi(this, 'CitationAnalysisAPI', {
      restApiName: 'CitationAnalysis-API',
      description: 'API for Citation Analysis Dashboard - v2',
      // No `AWS::ApiGateway::Account`: the account-wide CloudWatch role
      // setting is not this stack's to take over (no stage logs it). Pinned
      // here, not only by cdk.json's `disableCloudWatchRole` flag, so every
      // app that synthesizes the stack, specs included, renders the same.
      cloudWatchRole: false,
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        // Per-method CloudWatch metrics (Count, 4XXError, 5XXError, Latency,
        // IntegrationLatency) for every route on the stage.
        //
        // Without this the account had aggregate stage metrics only, so
        // "the API is throwing 5XXs" could never be narrowed to *which*
        // endpoint, and a per-endpoint alarm was not expressible at all —
        // there was no metric to alarm on (AUDIT-2026-08-19 §2.6).
        metricsEnabled: true,
        // dataTraceEnabled is deliberately LEFT OFF. Do not turn it on
        // alongside metricsEnabled — they look like a pair and are not.
        //
        // It logs full request and response bodies to CloudWatch, which here
        // means Cognito-authenticated user payloads, brand configuration, and
        // whole LLM responses. That is a privacy exposure with no retention
        // story and a log-ingestion bill proportional to response size, in
        // exchange for detail that X-Ray and the functions' own structured
        // logging already provide. Enable it temporarily on a single
        // reproduction if you must, then turn it back off.
        dataTraceEnabled: false,
      },
      // gzip/deflate JSON bodies of 1 KiB or more for clients that accept it
      // (browsers do). Cuts transfer for large pages several-fold; it does not
      // raise the Lambda 6 MiB response cap, which is measured before this.
      minCompressionSize: cdk.Size.kibibytes(1),
      // CORS preflight: wildcard at API Gateway, real origin check in the Lambdas (see API_CORS_PREFLIGHT).
      defaultCorsPreflightOptions: API_CORS_PREFLIGHT,
    });

    // Usage plan for API throttling and quota management
    const usagePlan = this.api.addUsagePlan('CitationAnalysisUsagePlan', {
      name: 'CitationAnalysis-UsagePlan',
      description: 'Usage plan for Citation Analysis API with rate limiting',
      throttle: {
        rateLimit: 100,  // Requests per second
        burstLimit: 200, // Burst capacity
      },
      quota: {
        limit: 10000,    // 10,000 requests per day
        period: apigateway.Period.DAY,
      },
    });
    usagePlan.addApiStage({ stage: this.api.deploymentStage });

    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: 'CitationAnalysis-CognitoAuthorizer',
      identitySource: 'method.request.header.Authorization',
    });

    const integrationOptions: apigateway.LambdaIntegrationOptions = { proxy: true };
    const methodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // Every route is a Lambda proxy integration behind the Cognito
    // authorizer, except the public health check.
    const route: Route = (resource, key, ...httpMethods) => {
      for (const httpMethod of httpMethods) {
        resource.addMethod(httpMethod, new apigateway.LambdaIntegration(props.functions[key], integrationOptions), methodOptions);
      }
    };

    const apiResource = this.api.root.addResource('api');

    // Health check endpoint - No authentication required
    // NOSONAR: Health check must be public for load balancer/monitoring probes
    apiResource.addResource('health').addMethod('GET', new apigateway.LambdaIntegration(props.functions.health, integrationOptions), {
      authorizationType: apigateway.AuthorizationType.NONE, // NOSONAR
    });

    addDataRoutes(apiResource, route);
    addKeywordRoutes(apiResource, route);
    addRunRoutes(apiResource, route);
    addInsightRoutes(apiResource, route);
    addContentStudioRoutes(apiResource, route);
    addSettingsRoutes(apiResource, route);
    addExportRoutes(apiResource, route);

    this.addWildcardPermissions(props.functions);
    // Dev mode allows every origin so localhost can read the gateway
    // responses (Lambda-level CORS still validates per request).
    addCorsGatewayResponses(this.api, props.devMode ? '*' : props.dashboardOrigin);
  }

  /** One invoke permission per router for the whole API (see `WILDCARD_PERMISSION_FUNCTION_KEYS`). */
  private addWildcardPermissions(functions: DashboardApiFunctions): void {
    for (const key of WILDCARD_PERMISSION_FUNCTION_KEYS) {
      new lambda.CfnPermission(this, `${pascalCase(key)}ApiGatewayWildcard`, {
        action: 'lambda:InvokeFunction',
        functionName: functions[key].functionArn,
        principal: 'apigateway.amazonaws.com',
        sourceArn: this.api.arnForExecuteApi('*'),
      });
    }
  }
}

/** `keyword-mgmt` → `KeywordMgmt`, for construct ids. */
function pascalCase(key: string): string {
  return key.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

/** Stats, citations, searches, crawled content, raw responses, brand mentions and brand config. */
function addDataRoutes(apiResource: apigateway.IResource, route: Route): void {
  route(apiResource.addResource('stats'), 'stats-insights', 'GET');
  route(apiResource.addResource('citations'), 'citations-content', 'GET');
  route(apiResource.addResource('url-breakdown'), 'citations-content', 'GET');
  route(apiResource.addResource('searches'), 'citations-content', 'GET');
  route(apiResource.addResource('crawled-content'), 'citations-content', 'GET');

  // Raw Responses Browser API
  const rawResponsesResource = apiResource.addResource('raw-responses');
  route(rawResponsesResource.addResource('browse'), 'citations-content', 'GET');
  route(rawResponsesResource.addResource('file'), 'citations-content', 'GET');
  route(rawResponsesResource.addResource('download'), 'citations-content', 'GET');

  route(apiResource.addResource('brand-mentions'), 'brand-mentions', 'GET');

  const brandConfigResource = apiResource.addResource('brand-config');
  route(brandConfigResource, 'brand-config', 'GET', 'POST', 'PUT', 'DELETE');
  route(brandConfigResource.addResource('presets'), 'brand-config', 'GET');
  route(brandConfigResource.addResource('expand'), 'brand-config', 'POST');
  route(brandConfigResource.addResource('expand-all'), 'brand-config', 'POST');
  route(brandConfigResource.addResource('find-competitors'), 'brand-config', 'POST');
}

/** Keywords, keyword groups and keyword research. */
function addKeywordRoutes(apiResource: apigateway.IResource, route: Route): void {
  const keywordsResource = apiResource.addResource('keywords');
  route(keywordsResource, 'keyword-mgmt', 'GET', 'POST');
  // Static 'promote' segment is matched ahead of the '{id}' path parameter by API Gateway,
  // and it is POST-only while '{id}' is PUT/DELETE-only, so the two do not conflict.
  route(keywordsResource.addResource('promote'), 'keyword-mgmt', 'POST');
  route(keywordsResource.addResource('{id}'), 'keyword-mgmt', 'PUT', 'DELETE');

  // Keyword groups (folders of keywords, typically one per hotel). Same
  // consolidated function; `manage-keyword-groups.py` owns the routes.
  const keywordGroupsResource = apiResource.addResource('keyword-groups');
  route(keywordGroupsResource, 'keyword-mgmt', 'GET', 'POST');
  const keywordGroupIdResource = keywordGroupsResource.addResource('{id}');
  route(keywordGroupIdResource, 'keyword-mgmt', 'PUT', 'DELETE');
  route(keywordGroupIdResource.addResource('keywords'), 'keyword-mgmt', 'PUT');

  // Keyword Research API
  const keywordResearchResource = apiResource.addResource('keyword-research');
  route(keywordResearchResource.addResource('expand'), 'keyword-mgmt', 'POST');
  route(keywordResearchResource.addResource('competitor'), 'keyword-mgmt', 'POST');
  // POST /keyword-research/agent — start a research-agent job (2.5.0).
  route(keywordResearchResource.addResource('agent'), 'keyword-mgmt', 'POST');

  // /keyword-research/templates — the agent's saved system prompts. Open to
  // every authenticated user (the agent is meant to be configurable by the
  // people who run it); `{id}` here is a child of `templates`, not a sibling
  // of the job `{id}` below, so API Gateway accepts both variable parts.
  const keywordResearchTemplatesResource = keywordResearchResource.addResource('templates');
  route(keywordResearchTemplatesResource, 'keyword-mgmt', 'GET', 'POST');
  route(keywordResearchTemplatesResource.addResource('{id}'), 'keyword-mgmt', 'PUT', 'DELETE');

  route(keywordResearchResource.addResource('history'), 'keyword-mgmt', 'GET');

  const keywordResearchIdResource = keywordResearchResource.addResource('{id}');
  // GET by id is what the UI polls: the job, its per-provider steps and the
  // merged (partial) result. History was the only read before 2.2.0, so a
  // job that fell off the first page of the scan vanished from the poll.
  route(keywordResearchIdResource, 'keyword-mgmt', 'GET', 'DELETE');
  // POST /keyword-research/{id}/retry — re-run only the failed steps.
  route(keywordResearchIdResource.addResource('retry'), 'keyword-mgmt', 'POST');
}

/** Analysis runs, executions and schedules. */
function addRunRoutes(apiResource: apigateway.IResource, route: Route): void {
  route(apiResource.addResource('trigger-analysis'), 'execution-mgmt', 'POST');
  route(apiResource.addResource('trigger-keyword-analysis'), 'execution-mgmt', 'POST');
  route(apiResource.addResource('executions').addResource('{id}'), 'execution-mgmt', 'GET');

  const schedulesResource = apiResource.addResource('schedules');
  route(schedulesResource, 'config-mgmt', 'GET', 'POST');
  // Schedules v2 (2.3.0): the path parameter is the generated `sch-<hex>` id
  // (the EventBridge schedule Name); the display name lives in Description.
  // The path part stays `{name}`: API Gateway allows one variable sibling,
  // and CloudFormation creates the renamed resource before deleting the old
  // one, so `{id}` failed with "A sibling ({name}) already has a variable
  // path part". The handler reads either key.
  const scheduleIdResource = schedulesResource.addResource('{name}');
  route(scheduleIdResource, 'config-mgmt', 'GET', 'PUT', 'DELETE');
  // POST /schedules/{id}/run — start an analysis now with the schedule's scope.
  route(scheduleIdResource.addResource('run'), 'config-mgmt', 'POST');
}

/** Visibility, insights, recommendations, trends, reports, persona rankings and self-reflection. */
function addInsightRoutes(apiResource: apigateway.IResource, route: Route): void {
  const visibilityResource = apiResource.addResource('visibility');
  route(visibilityResource, 'stats-insights', 'GET');
  // The answers behind one sentiment count of the Sentiment report.
  route(visibilityResource.addResource('sentiment-examples'), 'stats-insights', 'GET');

  route(apiResource.addResource('prompt-insights'), 'stats-insights', 'GET');
  route(apiResource.addResource('citation-gaps'), 'stats-insights', 'GET');

  const recommendationsResource = apiResource.addResource('recommendations');
  route(recommendationsResource, 'stats-insights', 'GET');
  // POST /recommendations/{id}/status — set the action-tracking state
  // (new / in_progress / done / wontfix) for a given recommendation.
  // GET /recommendations/{id}/status — read the current state.
  // Both routed to the consolidated stats-insights Lambda which loads
  // recommendation-status.py via the ROUTE_MAP prefix match.
  route(recommendationsResource.addResource('{id}').addResource('status'), 'stats-insights', 'GET', 'POST');

  route(apiResource.addResource('trends'), 'stats-insights', 'GET');

  // Reports aggregator endpoints. /reports/overview returns the
  // cross-keyword executive-summary rollup; /reports/competitor
  // returns the per-competitor rollup (outranked keywords,
  // exclusive citation sources, prioritised outreach list).
  // Both are routed to the consolidated stats-insights Lambda so
  // they share the warm container with /trends, /recommendations,
  // /visibility, and /citation-gaps which they compose.
  const reportsResource = apiResource.addResource('reports');
  route(reportsResource.addResource('overview'), 'stats-insights', 'GET');
  route(reportsResource.addResource('competitor'), 'stats-insights', 'GET');
  // Per-run KPI history of a keyword group (the per-hotel report).
  route(reportsResource.addResource('group-kpis'), 'stats-insights', 'GET');
  const reportInsightsResource = reportsResource.addResource('insights');
  route(reportInsightsResource, 'stats-insights', 'GET');
  // Admin only, enforced in the handler (`@require_group`): spends one Bedrock call.
  route(reportInsightsResource.addResource('regenerate'), 'stats-insights', 'POST');

  route(apiResource.addResource('persona-rankings'), 'persona-rankings', 'GET');
  route(apiResource.addResource('self-reflection'), 'self-reflection', 'POST', 'GET');
}

/** Content Studio. Generation begins only after its pending row is durably inserted. */
function addContentStudioRoutes(apiResource: apigateway.IResource, route: Route): void {
  const contentStudioResource = apiResource.addResource('content-studio');
  route(contentStudioResource.addResource('ideas'), 'content-studio', 'GET');
  route(contentStudioResource.addResource('generate'), 'content-studio', 'POST');
  route(contentStudioResource.addResource('generate-batch'), 'content-studio', 'POST');
  route(contentStudioResource.addResource('status').addResource('{id}'), 'content-studio', 'GET');
  route(contentStudioResource.addResource('viewed'), 'content-studio', 'POST');
  route(contentStudioResource.addResource('history'), 'content-studio', 'GET');

  const contentStudioTemplatesResource = contentStudioResource.addResource('templates');
  route(contentStudioTemplatesResource, 'content-studio', 'GET', 'POST');
  route(contentStudioTemplatesResource.addResource('{id}'), 'content-studio', 'PUT', 'DELETE');

  route(contentStudioResource.addResource('batches').addResource('{batch_id}'), 'content-studio', 'GET');
  route(contentStudioResource.addResource('{id}'), 'content-studio', 'DELETE');
}

/** Personas, providers, alerts, custom reports, markets and users. */
function addSettingsRoutes(apiResource: apigateway.IResource, route: Route): void {
  const queryPromptsResource = apiResource.addResource('query-prompts');
  route(queryPromptsResource, 'config-mgmt', 'GET', 'POST');
  route(queryPromptsResource.addResource('{id}'), 'config-mgmt', 'PUT', 'DELETE', 'PATCH');

  const providersResource = apiResource.addResource('providers');
  route(providersResource, 'config-mgmt', 'GET');
  const providerIdResource = providersResource.addResource('{id}');
  route(providerIdResource, 'config-mgmt', 'PUT');
  route(providerIdResource.addResource('validate'), 'config-mgmt', 'POST');
  // Models the stored key can use, for the Settings model picker (admin-only in the handler).
  route(providerIdResource.addResource('models'), 'config-mgmt', 'GET');

  // KPI alert history, singleton settings, and explicit content markers.
  const alertsResource = apiResource.addResource('alerts');
  route(alertsResource, 'config-mgmt', 'GET');
  route(alertsResource.addResource('test-notification'), 'config-mgmt', 'POST');
  route(alertsResource.addResource('{id}').addResource('acknowledge'), 'config-mgmt', 'POST');
  route(alertsResource.addResource('settings'), 'config-mgmt', 'GET', 'PUT');
  route(alertsResource.addResource('content-changes'), 'config-mgmt', 'GET', 'POST');

  // Saved custom reports, open to every signed-in user (no admin gate in
  // the handler); `manage-custom-reports.py` owns the routes.
  const customReportsResource = apiResource.addResource('custom-reports');
  route(customReportsResource, 'config-mgmt', 'GET', 'POST');
  route(customReportsResource.addResource('{id}'), 'config-mgmt', 'PUT', 'DELETE');

  // Markets (2.37.0): one resource for the whole API. GET for every
  // signed-in user; PUT (replace the list) and POST (local keyword
  // suggestions) are Admin-gated in `manage-markets.py`.
  route(apiResource.addResource('markets'), 'config-mgmt', 'GET', 'PUT', 'POST');

  const usersResource = apiResource.addResource('users');
  route(usersResource, 'users', 'GET', 'POST');
  route(usersResource.addResource('groups'), 'users', 'GET');
  const userUsernameResource = usersResource.addResource('{username}');
  route(userUsernameResource, 'users', 'GET', 'PUT', 'DELETE');
  route(userUsernameResource.addResource('reset-password'), 'users', 'POST');
}

/**
 * The export service: every view's "Export all" (2.45.0). Owner-only, which
 * `exports.py` enforces; per-method invoke permissions (five methods).
 */
function addExportRoutes(apiResource: apigateway.IResource, route: Route): void {
  const exportsResource = apiResource.addResource('exports');
  route(exportsResource, 'exports', 'GET', 'POST');
  const exportIdResource = exportsResource.addResource('{id}');
  route(exportIdResource, 'exports', 'GET', 'DELETE');
  route(exportIdResource.addResource('seen'), 'exports', 'POST');
}
