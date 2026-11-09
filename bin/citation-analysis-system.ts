#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CitationAnalysisStack } from '../lib/citation-analysis-stack';
import { CitationAnalysisApiStack } from '../lib/api-stack';
import { CitationAnalysisEventsStack } from '../lib/events-stack';
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

// The MCP server has its own stack and REST API, so it can be removed without
// touching the dashboard. `cdk deploy --all` deploys every stack.
const mcpStack = new CitationAnalysisMcpStack(app, 'CitationAnalysisMcpStack', {
  env,
  description: 'Citation Analysis System - MCP server for AI assistants',
  inputs: stack.mcpInputs,
});
mcpStack.node.addDependency(stack);

// The SEO features (DataForSEO, Google AI Overviews engine) have their own stack
// and REST API for the same reason. It imports only the user pool and the
// CorsOrigin export, and is always deployed with the main stack: the main
// workflow calls its AI Overviews function by name.
const seoStack = new CitationAnalysisSeoStack(app, 'CitationAnalysisSeoStack', {
  env,
  description: 'Citation Analysis System - SEO API and Google AI Overviews engine',
  inputs: stack.seoInputs,
});
seoStack.node.addDependency(stack);

// Live events (AppSync Events and the relay from EventBridge) have their own
// stack: the main stack is near the 500-resource limit, and the push holds no
// data. It reads the user pool id from the SSM parameter the main stack
// writes, so it deploys after it; the API stack reads its endpoints into
// config.json, so it deploys after this one.
const eventsStack = new CitationAnalysisEventsStack(app, 'CitationAnalysisEventsStack', {
  env,
  description: 'Citation Analysis System - live events (AppSync Events) for the dashboard',
});
eventsStack.node.addDependency(stack);

// The dashboard REST API has its own stack: its ~300 API Gateway resources
// took the main stack to CloudFormation's 500-resource limit. It takes no
// cross-stack reference from the main stack (function ARNs from fixed names,
// the user pool, distribution and origin from SSM parameters the main stack
// writes), so this dependency is what makes `cdk deploy --all` deploy the
// main stack first. lib/api-stack.spec.ts checks it is here.
const apiStack = new CitationAnalysisApiStack(app, 'CitationAnalysisApiStack', {
  env,
  description: 'Citation Analysis System - dashboard REST API',
});
apiStack.node.addDependency(stack);
apiStack.node.addDependency(eventsStack);

// Amazon Bedrock Web Search only exists in three regions, so its gateway has its
// own stack in a fixed region. The main stack reaches it through the SSM
// parameter name and region constants only: no dependency, no cross-stack reference.
const webSearchStack = new CitationAnalysisWebSearchStack(app, 'CitationAnalysisWebSearchStack', {
  env: { account: env.account, region: readWebSearchRegion(app) },
  description: 'Citation Analysis System - Amazon Bedrock Web Search gateway',
});

for (const taggedStack of [stack, apiStack, eventsStack, mcpStack, seoStack, webSearchStack]) {
  cdk.Tags.of(taggedStack).add('Application', 'CitationAnalysis');
}

app.synth();
