import {
  extractApiAuthSnapshots,
  extractFunctionRoleActionsOn,
  extractTableProperty,
  findStateMachineLogicalId,
  methodRouteLabels,
  resolvePath,
  sortedUnique,
} from './citation-analysis-stack-fixtures';
import { SEO_AUDITS_TABLE_NAME, SITE_AUDIT_STATE_MACHINE_NAME } from './constructs/seo-site-audit';
import {
  functionActionsMentioning,
  keyLabels,
  sharedFunctionEnvironments,
  stateMachineDefinitionJson,
  synthesizeSeoFeatureTemplate,
} from './seo-feature-fixtures';
import { SEO_ROUTER } from './seo-stack-fixtures';
import { SEO_JOBS_FUNCTION_NAME } from './seo-stack';

/**
 * Names in every ARN of the audit state machine and its executions (the
 * machine's logical id, the execution ARNs' `CitationAnalysis-SiteAudit:*`)
 * and in no other feature's.
 */
const SITE_AUDIT_MARKER = 'SiteAudit';

/** One Task state of the audit state machine: its timeout and the errors it retries. */
interface TaskSnapshot {
  timeoutSeconds: unknown;
  retriedErrors: string[];
  maxAttempts: number[];
  caughtErrors: string[];
}

/** The site-audit resources of the synthesized SEO stack. */
export interface SiteAuditSnapshot {
  routes: string[];
  /** The table's keys as `"<attribute> <HASH|RANGE>"`. */
  tableKeys: string[];
  tableTimeToLive: unknown;
  tableIndexes: unknown;
  stateNames: string[];
  tasks: Record<string, TaskSnapshot>;
  stateMachineTimeoutSeconds: unknown;
  waitSecondsPath: unknown;
  routerActionsOnStateMachine: string[];
  /** Step Functions actions of the router and jobs roles on the audit state machine and its executions. */
  routerStatesActions: string[];
  jobsStatesActions: string[];
  routerEnv: Record<string, unknown>;
  jobsEnv: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function taskSnapshot(state: Record<string, unknown>): TaskSnapshot {
  const retries = Array.isArray(state.Retry) ? state.Retry.map(record) : [];
  const catches = Array.isArray(state.Catch) ? state.Catch.map(record) : [];
  return {
    timeoutSeconds: state.TimeoutSeconds,
    retriedErrors: retries.flatMap((retry) => stringList(retry.ErrorEquals)),
    maxAttempts: retries.map((retry) => Number(retry.MaxAttempts)),
    caughtErrors: catches.flatMap((entry) => stringList(entry.ErrorEquals)),
  };
}

function statesActions(actions: string[]): string[] {
  return actions.filter((action) => action.startsWith('states:'));
}

/** Synthesize the SEO stack and read its site-audit resources. */
export function synthesizeSiteAuditSnapshot(): SiteAuditSnapshot {
  const template = synthesizeSeoFeatureTemplate();
  const methods = extractApiAuthSnapshots(template).filter((method) => method.path.includes('/audits'));
  const definition = stateMachineDefinitionJson(template, SITE_AUDIT_STATE_MACHINE_NAME);
  const states = record(definition.States);
  const taskEntries = Object.entries(states).filter(([, state]) => record(state).Type === 'Task');
  const stateMachineId = findStateMachineLogicalId(template, SITE_AUDIT_STATE_MACHINE_NAME);
  return {
    routes: sortedUnique(methodRouteLabels(methods)),
    tableKeys: keyLabels(extractTableProperty(template, SEO_AUDITS_TABLE_NAME, 'KeySchema')),
    tableTimeToLive: extractTableProperty(template, SEO_AUDITS_TABLE_NAME, 'TimeToLiveSpecification'),
    tableIndexes: extractTableProperty(template, SEO_AUDITS_TABLE_NAME, 'GlobalSecondaryIndexes'),
    stateNames: sortedUnique(Object.keys(states)),
    tasks: Object.fromEntries(taskEntries.map(([name, state]) => [name, taskSnapshot(record(state))])),
    stateMachineTimeoutSeconds: definition.TimeoutSeconds,
    waitSecondsPath: resolvePath(states, ['CrawlPause', 'SecondsPath']),
    routerActionsOnStateMachine: extractFunctionRoleActionsOn(template, SEO_ROUTER, stateMachineId),
    routerStatesActions: statesActions(functionActionsMentioning(template, SEO_ROUTER, SITE_AUDIT_MARKER)),
    jobsStatesActions: statesActions(functionActionsMentioning(template, SEO_JOBS_FUNCTION_NAME, SITE_AUDIT_MARKER)),
    ...sharedFunctionEnvironments(template),
  };
}
