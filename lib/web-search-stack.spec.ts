import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import { readWebSearchRegion } from './constructs/web-search';
import { ACCOUNT, synthesizeWebSearchTemplate } from './web-search-stack-fixtures';

describe('CitationAnalysisWebSearchStack', () => {
  const template = synthesizeWebSearchTemplate('us-east-1');

  it('creates an MCP gateway authorized by IAM and named for the account and region', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
      Name: `citation-analysis-web-search-${ACCOUNT}-us-east-1`,
      ProtocolType: 'MCP',
      AuthorizerType: 'AWS_IAM',
    });
    expect(Object.keys(template.findResources('AWS::BedrockAgentCore::Gateway'))).toHaveLength(1);
  });

  it('adds the web-search connector target authorized by the gateway role', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::GatewayTarget', {
      Name: 'web-search-tool',
      TargetConfiguration: { Mcp: { Connector: { Source: { ConnectorId: 'web-search' } } } },
      CredentialProviderConfigurations: [{ CredentialProviderType: 'GATEWAY_IAM_ROLE' }],
    });
    expect(Object.keys(template.findResources('AWS::BedrockAgentCore::GatewayTarget'))).toHaveLength(1);
  });

  it('lets only AgentCore of this account assume the gateway role', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [Match.objectLike({
          Principal: { Service: 'bedrock-agentcore.amazonaws.com' },
          Condition: { StringEquals: { 'aws:SourceAccount': ACCOUNT } },
        })],
      },
    });
    expect(Object.keys(template.findResources('AWS::IAM::Role'))).toHaveLength(1);
  });

  it('grants the gateway role only InvokeWebSearch on the regional web-search tool', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [{
          Action: 'bedrock-agentcore:InvokeWebSearch',
          Effect: 'Allow',
          Resource: 'arn:aws:bedrock-agentcore:us-east-1:aws:tool/web-search.v1',
        }],
      },
    });
    expect(Object.keys(template.findResources('AWS::IAM::Policy'))).toHaveLength(1);
  });

  it('follows the stack region in the tool ARN when deployed to eu-west-1', () => {
    synthesizeWebSearchTemplate('eu-west-1').hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [Match.objectLike({ Resource: 'arn:aws:bedrock-agentcore:eu-west-1:aws:tool/web-search.v1' })],
      },
    });
    expect(readWebSearchRegion(new cdk.App({ context: { webSearchRegion: 'eu-west-1' } }))).toBe('eu-west-1');
  });

  it('publishes the gateway URL under the contract SSM parameter name', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/citation-analysis/web-search/gateway-url',
      Type: 'String',
      Value: { 'Fn::GetAtt': [Match.stringLikeRegexp('^Gateway'), 'GatewayUrl'] },
    });
    expect(Object.keys(template.findOutputs('*'))).toStrictEqual(['WebSearchGatewayUrl']);
  });
});

describe('readWebSearchRegion', () => {
  it('defaults to us-east-1 when no context is set', () => {
    expect(readWebSearchRegion(new cdk.App())).toBe('us-east-1');
  });

  it.each(['us-west-2', 'eu-central-1', ''.concat('US-EAST-1')])('rejects %s as a Web Search region', (region) => {
    const app = new cdk.App({ context: { webSearchRegion: region } });

    expect(() => readWebSearchRegion(app)).toThrow("CDK context 'webSearchRegion': must be one of us-east-1, eu-west-1, ap-northeast-1");
  });

  it('rejects a non-string value', () => {
    const app = new cdk.App({ context: { webSearchRegion: 7 } });

    expect(() => readWebSearchRegion(app)).toThrow('got 7');
  });
});
