import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  describe, it, expect, beforeAll 
} from 'vitest';
import { CitationAnalysisStack } from './citation-analysis-stack';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Walk a nested unknown structure without unsafe member access. */
function resolvePath(root: unknown, keys: string[]): unknown {
  return keys.reduce<unknown>(
    (current, key) => (isRecord(current) ? current[key] : undefined),
    root
  );
}

/**
 * Extract the Step Functions definition JSON from the synthesized template.
 * Fn::Join produces ["", [...parts]]; string parts are concatenated and
 * object refs replaced with a placeholder.
 */
function extractStateMachineDefinition(template: Template): string {
  const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
  const logicalId = Object.keys(stateMachines)[0];
  const joinArgs = resolvePath(stateMachines[logicalId], ['Properties', 'DefinitionString', 'Fn::Join']);
  const parts = Array.isArray(joinArgs) && Array.isArray(joinArgs[1]) ? joinArgs[1] : [];
  return parts
    .map((part) => (typeof part === 'string' ? part : '"__REF__"'))
    .join('');
}

function extractLambdaEnvVars(template: Template, functionName: string): Record<string, unknown> {
  const lambdas = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: functionName },
  });
  const logicalId = Object.keys(lambdas)[0];
  const envVars = resolvePath(lambdas[logicalId], ['Properties', 'Environment', 'Variables']);
  return isRecord(envVars) ? envVars : {};
}

const synthesized: {
  definitionRaw: string;
  crawlerEnvVars: Record<string, unknown>;
  parseKeywordsEnvVars: Record<string, unknown>;
} = {
  definitionRaw: '',
  crawlerEnvVars: {},
  parseKeywordsEnvVars: {},
};

beforeAll(() => {
  const app = new cdk.App();
  const stack = new CitationAnalysisStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  synthesized.definitionRaw = extractStateMachineDefinition(template);
  synthesized.crawlerEnvVars = extractLambdaEnvVars(template, 'CitationAnalysis-Crawler');
  synthesized.parseKeywordsEnvVars = extractLambdaEnvVars(template, 'CitationAnalysis-ParseKeywords');
}, 60_000);

describe('Step Functions workflow', () => {
  it('passes keyword to CrawlCitations Map itemSelector', () => {
    // Verify the CrawlCitations state includes keyword.$ in its ItemSelector
    expect(synthesized.definitionRaw).toContain('"keyword.$":"$.keyword"');
  });

  it('selects query_prompts from the ParseKeywords output in ProcessKeywords Map', () => {
    expect(synthesized.definitionRaw).toContain('"query_prompts.$":"$.query_prompts"');
  });

  it('does not reference query_prompts from the raw execution input', () => {
    // Scheduled executions ({"source":"dynamodb"} or {"keywords":[...]}) carry
    // no query_prompts key in their input; a $$.Execution.Input.query_prompts
    // reference would raise States.Runtime for every scheduled run.
    expect(synthesized.definitionRaw).not.toContain('$$.Execution.Input.query_prompts');
  });
});

describe('ParseKeywords Lambda environment', () => {
  it('includes the query prompts table for execution-time prompt resolution', () => {
    expect(synthesized.parseKeywordsEnvVars).toHaveProperty('DYNAMODB_TABLE_QUERY_PROMPTS');
    expect(synthesized.parseKeywordsEnvVars).toHaveProperty('QUERY_PROMPTS_TABLE');
  });
});

describe('Crawler Lambda environment', () => {
  it('does not include unused BROWSER_TIMEOUT_MS env var', () => {
    expect(synthesized.crawlerEnvVars).not.toHaveProperty('BROWSER_TIMEOUT_MS');
  });

  it('does not include unused PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD env var', () => {
    expect(synthesized.crawlerEnvVars).not.toHaveProperty('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD');
  });

  it('does not include unused NOVA_ACT_SECRET_NAME env var', () => {
    expect(synthesized.crawlerEnvVars).not.toHaveProperty('NOVA_ACT_SECRET_NAME');
  });
});
