#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CitationAnalysisStack } from '../lib/citation-analysis-stack';

const app = new cdk.App();

const stack = new CitationAnalysisStack(app, 'CitationAnalysisStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'Citation Analysis System - Multi-model AI citation comparison and analysis',
});

cdk.Tags.of(stack).add('Application', 'CitationAnalysis');

app.synth();
