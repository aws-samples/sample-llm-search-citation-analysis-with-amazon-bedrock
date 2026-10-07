#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CitationAnalysisStack } from '../lib/citation-analysis-stack';
import { CitationAnalysisMcpStack } from '../lib/mcp-stack';

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

for (const taggedStack of [stack, mcpStack]) {
  cdk.Tags.of(taggedStack).add('Application', 'CitationAnalysis');
}

app.synth();
