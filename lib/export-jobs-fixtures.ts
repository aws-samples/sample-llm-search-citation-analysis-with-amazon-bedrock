import type { Template } from 'aws-cdk-lib/assertions';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { DashboardStacks } from './api-stack-fixtures';
import {
  allowStatementsOfRole,
  collectRefTargets,
  extractApiAuthSnapshots,
  findFunctionRoleLogicalId,
  findLambdaLogicalId,
  findStateMachineLogicalId,
  resolvePath,
  resolveString,
  statementActions,
  type ApiMethodAuthSnapshot,
} from './citation-analysis-stack-fixtures';
import { EXPORT_STATE_MACHINE_NAME, EXPORTS_TABLE_NAME } from './citation-analysis-stack';

export const EXPORT_WORKER_FUNCTION_NAME = 'CitationAnalysis-ExportWorker';
export const EXPORTS_API_FUNCTION_NAME = 'CitationAnalysis-API-Exports';
const GENERATE_SUMMARY_FUNCTION_NAME = 'CitationAnalysis-GenerateSummary';
const VIEW_JOB_FINISHED_RULE_NAME = 'CitationAnalysis-ViewJobFinished';

/** One Allow statement of a role: its actions and its resources as JSON text (tokens matchable as text). */
export interface RoleStatementSnapshot {
  actions: string[];
  resources: string;
  /** The statement's `Condition` as JSON text (`undefined` when it has none). */
  conditions?: string;
}

/** One state of the export state machine definition, with the parts the spec asserts on. */
export interface ExportStateSnapshot {
  type: string;
  next?: string;
  /** A Task's `Resource`, tokens replaced by `REF`. */
  resource?: string;
  parameters?: Record<string, unknown>;
  /** A Task's `TimeoutSeconds`. */
  timeoutSeconds?: number;
  /** A Task's `ResultPath` (`null`: the result is discarded). */
  resultPath?: unknown;
  retry: { errors: string[]; maxAttempts: number }[];
  /** `resultPath` is `null` when the error is discarded. */
  catch: { errors: string[]; next: string; resultPath: unknown }[];
  choices?: unknown[];
  defaultState?: string;
  /** A Wait state's `SecondsPath`. */
  secondsPath?: string;
}

/** Everything the export-service spec asserts on, read once from both templates. */
export interface ExportServiceSnapshot {
  startAt: string;
  timeoutSeconds: number;
  states: Record<string, ExportStateSnapshot>;
  stateMachineLogicalId: string;
  stateMachineRoleStatements: RoleStatementSnapshot[];
  workerLogicalId: string;
  workerTimeout: unknown;
  workerMemory: unknown;
  workerEnvironment: Record<string, unknown>;
  workerStatements: RoleStatementSnapshot[];
  /** The `view-job.finished` rule's properties. */
  viewJobRule: Record<string, unknown>;
  /** Principals and source ARNs allowed to invoke the worker (`AWS::Lambda::Permission`). */
  workerInvokePermissions: { principal: string; sourceArn: string }[];
  generateSummaryStatements: RoleStatementSnapshot[];
  apiEnvironment: Record<string, unknown>;
  apiStatements: RoleStatementSnapshot[];
  apiHandler: unknown;
  table: Record<string, unknown>;
  tableDeletionPolicy: string;
  exportsLifecycleRule: unknown;
  exportRoutes: ApiMethodAuthSnapshot[];
  /** Logical ids, in the main template, of the function named by each key. */
  functionLogicalIds: Record<string, string>;
  mainResourceCount: number;
  apiResourceCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The definition JSON with every CloudFormation token replaced by `REF` (tokens sit inside JSON strings). */
function parsedDefinition(template: Template, logicalId: string): Record<string, unknown> {
  const joinArgs = resolvePath(template.toJSON(), ['Resources', logicalId, 'Properties', 'DefinitionString', 'Fn::Join']);
  const parts: unknown[] = Array.isArray(joinArgs) && Array.isArray(joinArgs[1]) ? joinArgs[1] : [];
  const parsed: unknown = JSON.parse(parts.map((part) => (typeof part === 'string' ? part : 'REF')).join(''));
  return isRecord(parsed) ? parsed : {};
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringsOf(value: unknown): string[] {
  return listOf(value).filter((entry): entry is string => typeof entry === 'string');
}

/** The `Resource`, `TimeoutSeconds` and `ResultPath` a Task state sets (none of them for other states). */
function taskFields(state: unknown): Pick<ExportStateSnapshot, 'resource' | 'timeoutSeconds' | 'resultPath'> {
  const resource = resolvePath(state, ['Resource']);
  const timeout = resolvePath(state, ['TimeoutSeconds']);
  return {
    ...(typeof resource === 'string' ? { resource } : {}),
    ...(typeof timeout === 'number' ? { timeoutSeconds: timeout } : {}),
    ...(isRecord(state) && 'ResultPath' in state ? { resultPath: state.ResultPath } : {}),
  };
}

function stateSnapshot(state: unknown): ExportStateSnapshot {
  const next = resolvePath(state, ['Next']);
  const parameters = resolvePath(state, ['Parameters', 'Payload']);
  const defaultState = resolvePath(state, ['Default']);
  return {
    type: resolveString(state, ['Type']),
    ...(typeof next === 'string' ? { next } : {}),
    ...taskFields(state),
    ...(isRecord(parameters) ? { parameters } : {}),
    retry: listOf(resolvePath(state, ['Retry'])).map((retry) => ({
      errors: stringsOf(resolvePath(retry, ['ErrorEquals'])),
      maxAttempts: Number(resolvePath(retry, ['MaxAttempts'])),
    })),
    catch: listOf(resolvePath(state, ['Catch'])).map((entry) => ({
      errors: stringsOf(resolvePath(entry, ['ErrorEquals'])),
      next: resolveString(entry, ['Next']),
      resultPath: resolvePath(entry, ['ResultPath']),
    })),
    ...(resolvePath(state, ['Choices']) === undefined ? {} : { choices: listOf(resolvePath(state, ['Choices'])) }),
    ...(typeof defaultState === 'string' ? { defaultState } : {}),
    ...(typeof resolvePath(state, ['SecondsPath']) === 'string' ? { secondsPath: resolveString(state, ['SecondsPath']) } : {}),
  };
}

function roleStatements(template: Template, roleLogicalId: string): RoleStatementSnapshot[] {
  return allowStatementsOfRole(template, roleLogicalId).map((statement) => {
    const conditions = resolvePath(statement, ['Condition']);
    return {
      actions: statementActions(statement),
      resources: JSON.stringify(resolvePath(statement, ['Resource'])) ?? '',
      ...(conditions === undefined ? {} : { conditions: JSON.stringify(conditions) }),
    };
  });
}

function viewJobRuleProperties(template: Template): Record<string, unknown> {
  const [rule] = Object.values(template.findResources('AWS::Events::Rule', { Properties: { Name: VIEW_JOB_FINISHED_RULE_NAME } }));
  const properties = resolvePath(rule, ['Properties']);
  return isRecord(properties) ? properties : {};
}

function invokePermissions(template: Template, functionLogicalId: string): { principal: string; sourceArn: string }[] {
  return Object.values(template.findResources('AWS::Lambda::Permission'))
    .filter((permission) => getAttTargets(JSON.stringify(resolvePath(permission, ['Properties', 'FunctionName'])) ?? '').includes(functionLogicalId))
    .map((permission) => ({
      principal: resolveString(permission, ['Properties', 'Principal']),
      sourceArn: JSON.stringify(resolvePath(permission, ['Properties', 'SourceArn'])) ?? '',
    }));
}

function functionProperties(template: Template, functionName: string): unknown {
  return resolvePath(template.toJSON(), ['Resources', findLambdaLogicalId(template, functionName), 'Properties']);
}

function environmentOf(template: Template, functionName: string): Record<string, unknown> {
  const variables = resolvePath(functionProperties(template, functionName), ['Environment', 'Variables']);
  return isRecord(variables) ? variables : {};
}

function exportsTableEntry(template: Template): unknown {
  const tables = template.findResources('AWS::DynamoDB::Table', { Properties: { TableName: EXPORTS_TABLE_NAME } });
  return tables[Object.keys(tables)[0] ?? ''];
}

function keywordsBucketRule(template: Template, ruleId: string): unknown {
  const [bucket] = Object.values(template.findResources('AWS::S3::Bucket'))
    .filter((candidate) => JSON.stringify(resolvePath(candidate, ['Properties', 'BucketName'])).includes('citation-analysis-keywords'));
  return listOf(resolvePath(bucket, ['Properties', 'LifecycleConfiguration', 'Rules']))
    .find((rule) => resolveString(rule, ['Id']) === ruleId);
}

function functionLogicalIdsByName(template: Template): Record<string, string> {
  return Object.fromEntries(
    Object.entries(template.findResources('AWS::Lambda::Function'))
      .map(([logicalId, resource]) => [resolveString(resource, ['Properties', 'FunctionName']), logicalId])
  );
}

/** Logical ids an `Fn::GetAtt` in the JSON text `json` targets. */
function getAttTargets(json: string): string[] {
  return [...json.matchAll(/"Fn::GetAtt":\["(\w+)"/g)].map((match) => match[1]);
}

/** Logical ids the `Resource` JSON of `statements` with `action` references (Ref and GetAtt). */
export function referencedLogicalIds(statements: RoleStatementSnapshot[], action: string): string[] {
  const ids = statements
    .filter((statement) => statement.actions.includes(action))
    .flatMap((statement) => [...collectRefTargets(JSON.parse(statement.resources)), ...getAttTargets(statement.resources)]);
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

/** Resource JSON of every statement of `statements` that grants `action`. */
export function resourcesGranting(statements: RoleStatementSnapshot[], action: string): string[] {
  return statements.filter((statement) => statement.actions.includes(action)).map((statement) => statement.resources);
}

/** The `view-job.finished` source and detail type, as `test-fixtures/view-job-events.json` records them for both languages. */
export function readViewJobEventNames(): { source: unknown; detailType: unknown } {
  const parsed: unknown = JSON.parse(readFileSync(path.join(__dirname, '..', 'test-fixtures', 'view-job-events.json'), 'utf-8'));
  return { source: resolvePath(parsed, ['source']), detailType: resolvePath(parsed, ['detail_type']) };
}

/** Read the export service out of the synthesized main and API stacks. */
export function extractExportServiceSnapshot({ mainTemplate, apiTemplate }: DashboardStacks): ExportServiceSnapshot {
  const stateMachineLogicalId = findStateMachineLogicalId(mainTemplate, EXPORT_STATE_MACHINE_NAME);
  const definition = parsedDefinition(mainTemplate, stateMachineLogicalId);
  const states = isRecord(definition.States) ? definition.States : {};
  const stateMachineRole = getAttTargets(
    JSON.stringify(resolvePath(mainTemplate.toJSON(), ['Resources', stateMachineLogicalId, 'Properties', 'RoleArn'])) ?? ''
  )[0] ?? '';
  const table = exportsTableEntry(mainTemplate);
  const tableProperties = resolvePath(table, ['Properties']);
  const workerLogicalId = findLambdaLogicalId(mainTemplate, EXPORT_WORKER_FUNCTION_NAME);
  return {
    startAt: String(definition.StartAt),
    timeoutSeconds: Number(definition.TimeoutSeconds),
    states: Object.fromEntries(Object.entries(states).map(([name, state]) => [name, stateSnapshot(state)])),
    stateMachineLogicalId,
    stateMachineRoleStatements: roleStatements(mainTemplate, stateMachineRole),
    workerLogicalId,
    workerTimeout: resolvePath(functionProperties(mainTemplate, EXPORT_WORKER_FUNCTION_NAME), ['Timeout']),
    workerMemory: resolvePath(functionProperties(mainTemplate, EXPORT_WORKER_FUNCTION_NAME), ['MemorySize']),
    workerEnvironment: environmentOf(mainTemplate, EXPORT_WORKER_FUNCTION_NAME),
    workerStatements: roleStatements(mainTemplate, findFunctionRoleLogicalId(mainTemplate, EXPORT_WORKER_FUNCTION_NAME)),
    viewJobRule: viewJobRuleProperties(mainTemplate),
    workerInvokePermissions: invokePermissions(mainTemplate, workerLogicalId),
    generateSummaryStatements: roleStatements(mainTemplate, findFunctionRoleLogicalId(mainTemplate, GENERATE_SUMMARY_FUNCTION_NAME)),
    apiEnvironment: environmentOf(mainTemplate, EXPORTS_API_FUNCTION_NAME),
    apiStatements: roleStatements(mainTemplate, findFunctionRoleLogicalId(mainTemplate, EXPORTS_API_FUNCTION_NAME)),
    apiHandler: resolvePath(functionProperties(mainTemplate, EXPORTS_API_FUNCTION_NAME), ['Handler']),
    table: isRecord(tableProperties) ? tableProperties : {},
    tableDeletionPolicy: resolveString(table, ['DeletionPolicy']),
    exportsLifecycleRule: keywordsBucketRule(mainTemplate, 'ExpireExports'),
    exportRoutes: extractApiAuthSnapshots(apiTemplate).filter((route) => route.path.startsWith('/api/exports')),
    functionLogicalIds: functionLogicalIdsByName(mainTemplate),
    mainResourceCount: Object.keys(mainTemplate.toJSON().Resources ?? {}).length,
    apiResourceCount: Object.keys(apiTemplate.toJSON().Resources ?? {}).length,
  };
}
