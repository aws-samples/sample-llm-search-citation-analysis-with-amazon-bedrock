import * as apigateway from 'aws-cdk-lib/aws-apigateway';

/**
 * CORS preflight: API Gateway handles OPTIONS with wildcard origins.
 * Actual CORS enforcement happens at Lambda level via the SSM parameter
 * `/citation-analysis/cors-origin`, which holds the CloudFront domain.
 * This two-layer approach is required because CloudFront is created after
 * API Gateway. The Lambda functions read the parameter and validate the
 * request origin.
 */
export const API_CORS_PREFLIGHT: apigateway.CorsOptions = {
  allowOrigins: apigateway.Cors.ALL_ORIGINS,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
  allowCredentials: false, // Must be false with wildcard origins
};

/**
 * Gateway responses (401/403/expired token, 504 integration timeout, the 5XX
 * fallback) carrying CORS headers restricted to `allowOrigin`.
 *
 * SECURITY: pass the CloudFront origin, not '*', so that auth failure details
 * (401/403) are not observable by arbitrary origins; '*' only in dev mode,
 * where Lambda-level CORS still validates per request.
 *
 * Integration failures (504 timeout, 5XX fallback) never reach the Lambda
 * response helper. They get the same restricted CORS headers as the auth
 * failures so browsers expose their HTTP status instead of masking them
 * as an opaque CORS/network failure.
 */
export function addCorsGatewayResponses(api: apigateway.RestApi, allowOrigin: string): void {
  const responseHeaders = {
    'Access-Control-Allow-Origin': `'${allowOrigin}'`,
    'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Api-Key'",
    'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
  };
  const corsGatewayResponses: [string, apigateway.ResponseType, string | undefined][] = [
    ['Unauthorized', apigateway.ResponseType.UNAUTHORIZED, '401'],
    ['AccessDenied', apigateway.ResponseType.ACCESS_DENIED, '403'],
    ['ExpiredToken', apigateway.ResponseType.EXPIRED_TOKEN, '403'],
    ['IntegrationTimeout', apigateway.ResponseType.INTEGRATION_TIMEOUT, '504'],
    ['DefaultServerError', apigateway.ResponseType.DEFAULT_5XX, undefined],
  ];
  for (const [id, type, statusCode] of corsGatewayResponses) {
    api.addGatewayResponse(id, { type, statusCode, responseHeaders });
  }
}
