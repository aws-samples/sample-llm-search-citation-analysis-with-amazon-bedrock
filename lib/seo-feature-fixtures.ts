import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import {
  allowStatementsOfRole,
  extractLambdaEnvVars,
  extractStateMachineDefinition,
  findFunctionRoleLogicalId,
  findStateMachineLogicalId,
  resolvePath,
  retrierErrors,
  sortedUnique,
  statementActions,
} from './citation-analysis-stack-fixtures';
import { SEO_ROUTER_FUNCTION_NAME } from './constructs/seo-api';
import { CitationAnalysisSeoStack, SEO_JOBS_FUNCTION_NAME } from './seo-stack';

/** The role of a SEO state machine: invoke the jobs function, deliver its logs, send its X-Ray traces. */
export const JOBS_STATE_MACHINE_ROLE_ACTIONS = [
  'lambda:InvokeFunction',
  'logs:CreateLogDelivery',
  'logs:DeleteLogDelivery',
  'logs:DescribeLogGroups',
  'logs:DescribeResourcePolicies',
  'logs:GetLogDelivery',
  'logs:ListLogDeliveries',
  'logs:PutResourcePolicy',
  'logs:UpdateLogDelivery',
  'xray:GetSamplingRules',
  'xray:GetSamplingTargets',
  'xray:PutTelemetryRecords',
  'xray:PutTraceSegments',
];

/** A table's `TimeToLiveSpecification` when items expire on their `ttl` attribute. */
export const TTL_ON_TTL_ATTRIBUTE = { AttributeName: 'ttl', Enabled: true };

const ENV = { account: '123456789012', region: 'eu-west-1' };

/**
 * The SEO stack on a stand-in user pool. A feature's resources depend on the
 * main stack only through the user pool, so its specs need no main stack.
 */
export function synthesizeSeoFeatureTemplate(): Template {
  const app = new cdk.App();
  const userPool = new cognito.UserPool(new cdk.Stack(app, 'PoolStack', { env: ENV }), 'Pool');
  return Template.fromStack(new CitationAnalysisSeoStack(app, 'SeoStack', { env: ENV, inputs: { userPool } }));
}

/** The environment variables of the two shared functions, the router and the jobs function. */
export function sharedFunctionEnvironments(template: Template): {
  routerEnv: Record<string, unknown>;
  jobsEnv: Record<string, unknown>;
} {
  return {
    routerEnv: extractLambdaEnvVars(template, SEO_ROUTER_FUNCTION_NAME),
    jobsEnv: extractLambdaEnvVars(template, SEO_JOBS_FUNCTION_NAME),
  };
}

/** Sorted actions of the role's statements whose resources mention `marker` (a logical id or a name). */
export function roleActionsMentioning(template: Template, roleLogicalId: string, marker: string): string[] {
  return sortedUnique(allowStatementsOfRole(template, roleLogicalId)
    .filter((statement) => String(JSON.stringify(resolvePath(statement, ['Resource']))).includes(marker))
    .flatMap(statementActions));
}

/** `roleActionsMentioning` for the role of the function named `functionName`. */
export function functionActionsMentioning(template: Template, functionName: string, marker: string): string[] {
  return roleActionsMentioning(template, findFunctionRoleLogicalId(template, functionName), marker);
}

/** The named state machine's definition; its tokens (always inside JSON strings) read as `__REF__`. */
export function stateMachineDefinitionJson(template: Template, stateMachineName: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    extractStateMachineDefinition(template, stateMachineName).split('"__REF__"').join('__REF__')
  );
  return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
}

/** The states of `states` by name, with the states of every Map's item processor flattened in. */
function flattenStates(states: unknown): Record<string, unknown> {
  if (typeof states !== 'object' || states === null) return {};
  return Object.fromEntries(Object.entries(states).flatMap(([name, state]) => [
    [name, state],
    ...Object.entries(flattenStates(resolvePath(state, ['ItemProcessor', 'States']))),
  ]));
}

/** Every state of the named state machine, by name (Map item processors included). */
export function stateMachineStates(template: Template, stateMachineName: string): Record<string, unknown> {
  return flattenStates(stateMachineDefinitionJson(template, stateMachineName).States);
}

/** The logical id of the named state machine's execution role. */
export function stateMachineRoleLogicalId(template: Template, stateMachineName: string): string {
  const machineId = findStateMachineLogicalId(template, stateMachineName);
  const roleArn = resolvePath(template.toJSON(), ['Resources', machineId, 'Properties', 'RoleArn', 'Fn::GetAtt']);
  return Array.isArray(roleArn) && typeof roleArn[0] === 'string' ? roleArn[0] : '';
}

/** A key schema as `"<attribute> <HASH|RANGE>"` labels. */
export function keyLabels(schema: unknown): string[] {
  return (Array.isArray(schema) ? schema : []).map(
    (key) => `${String(resolvePath(key, ['AttributeName']))} ${String(resolvePath(key, ['KeyType']))}`
  );
}

/** An EventBridge rule's schedule expression and its first target's input. */
export function ruleScheduleAndInput(rule: unknown): { ruleSchedule: unknown; ruleInput: unknown } {
  return {
    ruleSchedule: resolvePath(rule, ['Properties', 'ScheduleExpression']),
    ruleInput: resolvePath(rule, ['Properties', 'Targets', '0', 'Input']),
  };
}

/** `read` of each Task state, by state name. */
function taskValues<T>(states: Record<string, unknown>, read: (state: unknown) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(states)
    .filter(([, state]) => resolvePath(state, ['Type']) === 'Task')
    .map(([name, state]) => [name, read(state)]));
}

/** The error lists of each task state's retriers, by state name. */
export function taskRetriers(states: Record<string, unknown>): Record<string, unknown[]> {
  return taskValues(states, retrierErrors);
}

/** Logical ids of the `type` resources the feature built under construct id `constructId`. */
export function featureResourceIds(template: Template, constructId: string, type: string): string[] {
  return Object.keys(template.findResources(type)).filter((logicalId) => logicalId.startsWith(constructId));
}

/** Who may do what with a job state machine the router starts. */
interface RoutedJobWiring {
  /** Sorted actions of every statement of the state machine's role. */
  stateMachineRoleActions: string[];
  /** Sorted actions the router's role holds on the state machine and its executions. */
  routerStateMachineActions: string[];
  /** Names of the router's environment variables that reference the state machine. */
  routerVariables: string[];
}

/**
 * The wiring of a job state machine the router starts under the ARN in
 * `routerVariable`: its role only invokes the jobs function and writes its
 * logs and traces, and the router may only start executions.
 */
export function routedJobWiring(routerVariable: string): RoutedJobWiring {
  return {
    stateMachineRoleActions: JOBS_STATE_MACHINE_ROLE_ACTIONS,
    routerStateMachineActions: ['states:StartExecution'],
    routerVariables: [routerVariable],
  };
}

/** A job state machine the router starts, as synthesized. */
export interface RoutedJobSnapshot {
  /** The state machine's states, by name (tokens replaced by `__REF__`). */
  states: Record<string, unknown>;
  startAt: unknown;
  timeoutSeconds: unknown;
  /** Each Task state's retrier error lists, `TimeoutSeconds` and first catcher's target, by state name. */
  taskRetriers: Record<string, unknown[]>;
  taskTimeouts: Record<string, unknown>;
  taskCatchTargets: Record<string, unknown>;
  /** Compare with `routedJobWiring`. */
  wiring: RoutedJobWiring;
}

function routedJobWiringOf(template: Template, stateMachineName: string): RoutedJobWiring {
  const machineId = findStateMachineLogicalId(template, stateMachineName);
  const { routerEnv } = sharedFunctionEnvironments(template);
  return {
    stateMachineRoleActions: roleActionsMentioning(template, stateMachineRoleLogicalId(template, stateMachineName), ''),
    // By logical id (the machine's ARN) or by name (ARNs of its executions).
    routerStateMachineActions: sortedUnique([machineId, stateMachineName]
      .flatMap((marker) => functionActionsMentioning(template, SEO_ROUTER_FUNCTION_NAME, marker))),
    routerVariables: Object.keys(routerEnv).filter((name) => JSON.stringify(routerEnv[name]).includes(`"${machineId}"`)),
  };
}

/** The named job state machine, which the router starts, read from `template`. */
export function synthesizeRoutedJobSnapshot(template: Template, stateMachineName: string): RoutedJobSnapshot {
  const definition = stateMachineDefinitionJson(template, stateMachineName);
  const states = stateMachineStates(template, stateMachineName);
  return {
    states,
    startAt: resolvePath(definition, ['StartAt']),
    timeoutSeconds: resolvePath(definition, ['TimeoutSeconds']),
    taskRetriers: taskRetriers(states),
    taskTimeouts: taskValues(states, (state) => resolvePath(state, ['TimeoutSeconds'])),
    taskCatchTargets: taskValues(states, (state) => resolvePath(state, ['Catch', '0', 'Next'])),
    wiring: routedJobWiringOf(template, stateMachineName),
  };
}
