#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CitationAnalysisStack } from '../lib/citation-analysis-stack';
import { CitationAnalysisMcpStack } from '../lib/mcp-stack';
import { CitationAnalysisSeoStack } from '../lib/seo-stack';
import { readWebSearchRegion } from '../lib/constructs/web-search';
import { CitationAnalysisWebSearchStack } from '../lib/web-search-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const stack = new CitationAnalysisStack(app, 'CitationAnalysisStack', {
  env,
  description: 'Citation Analysis System - Multi-model AI citation comparison and analysis',
});

// The MCP server has its own stack and REST API: the main stack sits at
// CloudFormation's 500-resource limit. `cdk deploy --all` deploys both.
const mcpStack = new CitationAnalysisMcpStack(app, 'CitationAnalysisMcpStack', {
  env,
  description: 'Citation Analysis System - MCP server for AI assistants',
  inputs: stack.mcpInputs,
});
mcpStack.node.addDependency(stack);

// The SEO features (DataForSEO, Google AI Overviews engine) have their own stack
// and REST API for the same reason. It imports only the user pool and the
// CorsOrigin export; deploy it before enabling `-c seoEngine=true`, which makes
// the main workflow call its AI Overviews function by name.
const seoStack = new CitationAnalysisSeoStack(app, 'CitationAnalysisSeoStack', {
  env,
  description: 'Citation Analysis System - SEO API and Google AI Overviews engine',
  inputs: stack.seoInputs,
});
seoStack.node.addDependency(stack);

// Amazon Bedrock Web Search only exists in some regions, so its gateway has its
// own stack in a fixed region. The main stack reaches it through the SSM
// parameter name and region constants only: no dependency, no cross-stack reference.
const webSearchStack = new CitationAnalysisWebSearchStack(app, 'CitationAnalysisWebSearchStack', {
  env: { account: env.account, region: readWebSearchRegion(app) },
  description: 'Citation Analysis System - Amazon Bedrock Web Search gateway',
});

for (const taggedStack of [stack, mcpStack, seoStack, webSearchStack]) {
  cdk.Tags.of(taggedStack).add('Application', 'CitationAnalysis');
}

app.synth();
