import {
  describe, expect, it
} from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CitationAnalysisStack } from './citation-analysis-stack';
import {
  extractLambdaEnvVars, extractLambdaLayerRefs, extractUserPoolClientProps, resolveString
} from './citation-analysis-stack-fixtures';
import { CitationAnalysisMcpStack, DEFAULT_REDIRECT_URIS } from './mcp-stack';

/**
 * The app wires `CitationAnalysisMcpStack` to the main stack's `mcpInputs`.
 * One synthesis of both proves the cross-stack references resolve and that the
 * MCP server does not land in the main stack, which sits at the 500-resource limit.
 */
describe('CitationAnalysisMcpStack', () => {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'eu-west-1' };
  const main = new CitationAnalysisStack(app, 'MainStack', { env });
  const mcpStack = new CitationAnalysisMcpStack(app, 'McpStack', { env, inputs: main.mcpInputs });
  const template = Template.fromStack(mcpStack);

  it('holds the MCP server, its own REST API, its CloudFront edge and its Cognito client', () => {
    const counts = ['AWS::ApiGateway::RestApi', 'AWS::CloudFront::Distribution', 'AWS::Cognito::UserPoolClient', 'AWS::ApiGateway::Authorizer']
      .map((type) => Object.keys(template.findResources(type)).length);

    expect(counts).toStrictEqual([1, 1, 1, 1]);
    expect(mcpStack.server.api.restApiName).toBe('CitationAnalysis-McpApi');
    template.hasResourceProperties('AWS::Lambda::Function', { FunctionName: 'CitationAnalysis-Mcp' });
  });

  it('calls exactly the nine API router Lambdas of the main stack and the SEO router', () => {
    const environment = extractLambdaEnvVars(template, 'CitationAnalysis-Mcp');
    // Cross-stack function names arrive as `Fn::Join` fragments, so match the router names themselves.
    const routers = JSON.stringify(environment)
      .match(/keyword-mgmt|config-mgmt|execution-mgmt|stats-insights|citations-content|brand-config|brand-mentions|persona-rankings|content-studio|CitationAnalysis-SeoRouter/g) ?? [];

    expect(new Set(routers).size).toBe(10);
  });

  it('lets the MCP server invoke the SEO router by its name', () => {
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));

    expect(policies).toContain('function:CitationAnalysis-SeoRouter"');
  });

  it('gives the MCP server no SEO limit of its own: the SEO API counts every client against one', () => {
    expect(JSON.stringify(extractLambdaEnvVars(template, 'CitationAnalysis-Mcp'))).not.toContain('seoCallsPerDay');
  });

  it('leaves the main stack without MCP resources', () => {
    const mainTemplate = Template.fromStack(main);

    expect(mainTemplate.findResources('AWS::Cognito::UserPoolResourceServer')).toStrictEqual({});
    expect(mainTemplate.findResources('AWS::Cognito::UserPoolDomain')).toStrictEqual({});
  });

  it('allows the Kiro and Claude Code local callbacks when mcpRedirectUris is not set', () => {
    expect(extractUserPoolClientProps(template).CallbackURLs).toStrictEqual(DEFAULT_REDIRECT_URIS);
    expect(DEFAULT_REDIRECT_URIS).toStrictEqual(['http://localhost:5173/oauth/callback', 'http://localhost:5173/callback']);
  });

  it('builds its own shared layer version instead of importing the main stack layer', () => {
    const layers = template.findResources('AWS::Lambda::LayerVersion');
    const layerNames = Object.values(layers).map((layer) => resolveString(layer, ['Properties', 'LayerName']));

    expect(layerNames).toStrictEqual(['CitationAnalysis-McpSharedLayer']);
    // A `Ref` to a layer of this template, not an `Fn::ImportValue` of the main stack's.
    expect(extractLambdaLayerRefs(template, 'CitationAnalysis-Mcp')).toStrictEqual(Object.keys(layers));
  });

  it('imports only values that never change for a resource from the main stack', () => {
    const imports = JSON.stringify(template.toJSON()).match(/"Fn::ImportValue":"[^"]+"/g) ?? [];
    const volatile = imports.filter((name) => /Layer|Version/.test(name));

    expect(imports.length).toBeGreaterThan(0);
    expect(volatile).toStrictEqual([]);
  });
});
