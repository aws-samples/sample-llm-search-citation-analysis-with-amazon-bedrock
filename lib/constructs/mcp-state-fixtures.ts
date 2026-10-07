import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import {
  allowStatementsOfRole,
  extractLambdaEnvVars,
  findFunctionRoleLogicalId,
  statementActions,
} from '../citation-analysis-stack-fixtures';
import { McpState, readMcpLimits, type McpLimits } from './mcp-state';

export const STATE_TEST_FUNCTION_NAME = 'Stub-McpServer';

export interface SynthesizedMcpState {
  template: Template;
  limits: McpLimits;
}

function stackWithContext(context: Record<string, unknown>): cdk.Stack {
  const app = new cdk.App({ context });
  return new cdk.Stack(app, 'McpStateTestStack', { env: { account: '123456789012', region: 'eu-west-1' } });
}

/** The state construct, its limits read from `context`, granted to one stub function. */
export function synthesizeMcpState(context: Record<string, unknown> = {}): SynthesizedMcpState {
  const stack = stackWithContext(context);
  const state = new McpState(stack, 'McpState', { limits: readMcpLimits(stack) });
  const serverFunction = new lambda.Function(stack, 'StubServer', {
    code: lambda.Code.fromInline('exports.handler = async () => ({});'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_22_X,
    functionName: STATE_TEST_FUNCTION_NAME,
  });
  state.grantTo(serverFunction);
  return { template: Template.fromStack(stack), limits: state.limits };
}

/** `readMcpLimits` on a bare stack whose `mcpLimits` context is `value`. */
export function limitsFromContext(value: unknown): McpLimits {
  return readMcpLimits(stackWithContext({ mcpLimits: value }));
}

/** The stub function's environment variables. */
export function extractStateEnvVars(template: Template): Record<string, unknown> {
  return extractLambdaEnvVars(template, STATE_TEST_FUNCTION_NAME);
}

/** Every action the stub function's role is allowed, sorted. */
export function extractGrantedActions(template: Template): string[] {
  const roleId = findFunctionRoleLogicalId(template, STATE_TEST_FUNCTION_NAME);
  return allowStatementsOfRole(template, roleId).flatMap(statementActions).sort((left, right) => left.localeCompare(right));
}
