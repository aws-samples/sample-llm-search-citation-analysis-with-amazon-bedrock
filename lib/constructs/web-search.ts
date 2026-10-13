import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * Amazon Bedrock Web Search (provider `agentcore`) runs through an AgentCore
 * Gateway that only exists in three regions, so it lives in its own stack
 * (`lib/web-search-stack.ts`). The main stack never references that stack
 * through CloudFormation: both sides share these constants, and the search
 * Lambdas read the gateway URL from SSM at run time.
 */
export const WEB_SEARCH_GATEWAY_URL_PARAMETER = '/citation-analysis/web-search/gateway-url';

/** The gateway target name; the MCP tool is `web-search-tool___WebSearch`. */
export const WEB_SEARCH_TARGET_NAME = 'web-search-tool';

export const WEB_SEARCH_CONNECTOR_ID = 'web-search';

export const WEB_SEARCH_ALLOWED_REGIONS: readonly string[] = ['us-east-1', 'eu-west-1', 'ap-northeast-1'];

export const WEB_SEARCH_DEFAULT_REGION = 'us-east-1';

const WEB_SEARCH_REGION_CONTEXT = 'webSearchRegion';

/** Thrown at synth time when `-c webSearchRegion=...` is not a Web Search region. */
export class InvalidWebSearchRegionError extends Error {
  constructor(message: string) {
    super(`CDK context '${WEB_SEARCH_REGION_CONTEXT}': ${message}`);
    this.name = 'InvalidWebSearchRegionError';
  }
}

/** The region of the gateway stack: CDK context `webSearchRegion`, default `us-east-1`. */
export function readWebSearchRegion(scope: Construct): string {
  const raw: unknown = scope.node.tryGetContext(WEB_SEARCH_REGION_CONTEXT);
  if (raw === undefined || raw === null || raw === '') {
    return WEB_SEARCH_DEFAULT_REGION;
  }
  if (typeof raw !== 'string' || !WEB_SEARCH_ALLOWED_REGIONS.includes(raw)) {
    throw new InvalidWebSearchRegionError(
      `must be one of ${WEB_SEARCH_ALLOWED_REGIONS.join(', ')}, got ${JSON.stringify(raw)}`
    );
  }
  return raw;
}

/**
 * What a caller needs to find and call the gateway: read its URL from SSM, sign
 * requests to it. One statement, since each action only matches its own
 * resource type. The account stays a real account (not `*`) so a gateway in
 * another account is never callable.
 */
export function webSearchPolicyStatement(account: string, region: string): iam.PolicyStatement {
  return new iam.PolicyStatement({
    actions: ['ssm:GetParameter', 'bedrock-agentcore:InvokeGateway'],
    resources: [
      `arn:aws:ssm:${region}:${account}:parameter${WEB_SEARCH_GATEWAY_URL_PARAMETER}`,
      `arn:aws:bedrock-agentcore:${region}:${account}:gateway/*`,
    ],
  });
}
