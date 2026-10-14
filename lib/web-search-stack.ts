import * as cdk from 'aws-cdk-lib';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import {
  WEB_SEARCH_CONNECTOR_ID, WEB_SEARCH_GATEWAY_URL_PARAMETER, WEB_SEARCH_TARGET_NAME, WEB_SEARCH_TOOL_CONFIGURATION
} from './constructs/web-search';

/**
 * The AgentCore Gateway with the managed `web-search` connector behind the
 * `agentcore` provider (Amazon Bedrock Web Search). Web Search exists only in
 * us-east-1, eu-west-1 and ap-northeast-1, so this is a separate stack with a
 * fixed region (`readWebSearchRegion`). It holds no data, so nothing is retained.
 */
export class CitationAnalysisWebSearchStack extends cdk.Stack {
  readonly gateway: bedrockagentcore.CfnGateway;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const role = new iam.Role(this, 'GatewayRole', {
      roleName: `CitationAnalysis-WebSearchGatewayRole-${this.region}`,
      description: 'Role the AgentCore Gateway assumes to call Amazon Bedrock Web Search',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    });
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore:InvokeWebSearch'],
      resources: [`arn:aws:bedrock-agentcore:${this.region}:aws:tool/web-search.v1`],
    }));

    this.gateway = new bedrockagentcore.CfnGateway(this, 'Gateway', {
      name: `citation-analysis-web-search-${this.account}-${this.region}`,
      description: 'Amazon Bedrock Web Search for the citation analysis search providers',
      protocolType: 'MCP',
      authorizerType: 'AWS_IAM',
      roleArn: role.roleArn,
    });

    const target = new bedrockagentcore.CfnGatewayTarget(this, 'WebSearchTarget', {
      name: WEB_SEARCH_TARGET_NAME,
      gatewayIdentifier: this.gateway.attrGatewayIdentifier,
      targetConfiguration: {
        mcp: {
          connector: {
            source: { connectorId: WEB_SEARCH_CONNECTOR_ID },
            // The service rejects a connector without its tool configuration ("Connector configurations must not be null").
            configurations: [{ name: WEB_SEARCH_TOOL_CONFIGURATION, parameterValues: {} }],
          },
        },
      },
      credentialProviderConfigurations: [{ credentialProviderType: 'GATEWAY_IAM_ROLE' }],
    });
    target.node.addDependency(role);

    const gatewayUrl = new ssm.StringParameter(this, 'GatewayUrlParameter', {
      parameterName: WEB_SEARCH_GATEWAY_URL_PARAMETER,
      description: 'MCP URL of the Web Search gateway, read by the search Lambdas at run time',
      stringValue: this.gateway.attrGatewayUrl,
    });
    gatewayUrl.node.addDependency(target);

    new cdk.CfnOutput(this, 'WebSearchGatewayUrl', {
      value: this.gateway.attrGatewayUrl,
      description: 'MCP URL of the Amazon Bedrock Web Search gateway',
    });
  }
}
