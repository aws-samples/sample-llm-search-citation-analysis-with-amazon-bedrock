import { describe, expect, it } from 'vitest';
import {
  ACCOUNT, functionRoleResourcesAllowing, synthesizeMainTemplate
} from './web-search-stack-fixtures';

const SSM_ARN = `arn:aws:ssm:us-east-1:${ACCOUNT}:parameter/citation-analysis/web-search/gateway-url`;
const GATEWAY_ARN = `arn:aws:bedrock-agentcore:us-east-1:${ACCOUNT}:gateway/*`;
const WEB_SEARCH_ENV = {
  WEB_SEARCH_REGION: 'us-east-1',
  WEB_SEARCH_GATEWAY_URL_PARAMETER: '/citation-analysis/web-search/gateway-url',
};

const template = synthesizeMainTemplate();

describe('main stack wiring of the agentcore provider', () => {
  it('creates the CitationAnalysis-Search-agentcore function with the web search environment', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'CitationAnalysis-Search-agentcore',
      ReservedConcurrentExecutions: 5,
      Environment: { Variables: WEB_SEARCH_ENV },
    });
    expect(Object.keys(template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'CitationAnalysis-Search-agentcore' },
    }))).toHaveLength(1);
  });

  it('passes the web search environment to the config-mgmt function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'CitationAnalysis-API-ConfigMgmt',
      Environment: { Variables: WEB_SEARCH_ENV },
    });
    expect(Object.keys(WEB_SEARCH_ENV)).toHaveLength(2);
  });

  it('lets the search role read the gateway URL parameter and invoke gateways in the web search region', () => {
    const name = 'CitationAnalysis-Search-agentcore';

    expect(functionRoleResourcesAllowing(template, name, 'ssm:GetParameter')).toStrictEqual([[SSM_ARN, GATEWAY_ARN]]);
    expect(functionRoleResourcesAllowing(template, name, 'bedrock-agentcore:InvokeGateway')).toStrictEqual([[SSM_ARN, GATEWAY_ARN]]);
  });

  it('lets the config-mgmt role read the gateway URL parameter and invoke gateways in the web search region', () => {
    const name = 'CitationAnalysis-API-ConfigMgmt';

    expect(functionRoleResourcesAllowing(template, name, 'ssm:GetParameter')).toContainEqual([SSM_ARN, GATEWAY_ARN]);
    expect(functionRoleResourcesAllowing(template, name, 'bedrock-agentcore:InvokeGateway')).toContainEqual([SSM_ARN, GATEWAY_ARN]);
  });

  it('references the web search stack through no import or export', () => {
    const raw = JSON.stringify(template.toJSON());

    expect(raw).not.toContain('Fn::ImportValue');
    expect(raw).not.toContain('BedrockAgentCore::Gateway');
  });

  it('keeps the stack within the 500 resource limit', () => {
    expect(Object.keys(template.toJSON().Resources).length).toBeLessThanOrEqual(500);
  });
});
