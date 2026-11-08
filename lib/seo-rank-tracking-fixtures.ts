import type { Template } from 'aws-cdk-lib/assertions';
import {
  allowStatementsOfRole,
  extractApiAuthSnapshots,
  extractFunctionRoleActionsOn,
  findFunctionRoleLogicalId,
  findLogicalIdByName,
  methodRouteLabels,
  resolvePath,
  sortedUnique,
  statementActions,
} from './citation-analysis-stack-fixtures';
import { RANK_CHECK_STATE_MACHINE_NAME, RANK_TRACKER_SCHEDULE_GROUP } from './constructs/seo-rank-tracking';
import { SEO_JOBS_FUNCTION_NAME } from './seo-stack';
import {
  functionActionsMentioning,
  keyLabels,
  roleActionsMentioning,
  sharedFunctionEnvironments,
  stateMachineDefinitionJson,
  stateMachineStates,
  synthesizeSeoFeatureTemplate,
} from './seo-feature-fixtures';
import { SEO_ROUTER } from './seo-stack-fixtures';

export const RANK_TABLE = 'CitationAnalysis-SeoRankTracking';
export const PAID_STATES = ['LiveChecks', 'PostTasks'];

/** The rank tracking resources of a synthesized SEO stack. */
interface RankTrackingSnapshot {
  template: Template;
  /** `"<VERB> <path>"` of every rank tracker method. */
  routes: string[];
  /** The table's keys as `"<attribute> <HASH|RANGE>"`, index names and TTL. */
  keys: string[];
  indexNames: string[];
  timeToLive: unknown;
  /** Actions the router and jobs roles hold on the table. */
  routerTableActions: string[];
  jobsTableActions: string[];
  /** The router's and the jobs role's statements on the rank check state machine. */
  routerRankCheckGrants: RankCheckGrant[];
  jobsRankCheckGrants: RankCheckGrant[];
  routerEnv: Record<string, unknown>;
  jobsEnv: Record<string, unknown>;
  /** The state machine definition's states, by name. */
  states: Record<string, unknown>;
  definitionTimeoutSeconds: unknown;
  /** Names of the stack's EventBridge Scheduler schedule groups and of its EventBridge rules. */
  scheduleGroups: string[];
  ruleNames: string[];
  /** Actions the router and jobs roles hold on the trackers' schedules. */
  routerScheduleActions: string[];
  jobsScheduleActions: string[];
  /** Actions the role EventBridge Scheduler assumes holds on the jobs function. */
  schedulerRoleJobsActions: string[];
}

/** One statement on the rank check state machine: its actions, and whether its resource is the machine itself. */
interface RankCheckGrant {
  actions: string[];
  onStateMachine: boolean;
}

const STATE_MACHINE_ARN_SUFFIX = `:stateMachine:${RANK_CHECK_STATE_MACHINE_NAME}"]]}`;

/**
 * The function role's statements naming the rank check state machine (its
 * ARN, or those of its executions); other features' statements are left out.
 */
function rankCheckGrants(template: Template, functionName: string): RankCheckGrant[] {
  return allowStatementsOfRole(template, findFunctionRoleLogicalId(template, functionName))
    .map((statement) => ({ actions: statementActions(statement), resource: JSON.stringify(resolvePath(statement, ['Resource'])) }))
    .filter(({ resource }) => resource.includes(RANK_CHECK_STATE_MACHINE_NAME))
    .map(({ actions, resource }) => ({ actions: sortedUnique(actions), onStateMachine: resource.endsWith(STATE_MACHINE_ARN_SUFFIX) }));
}

const TRACKER_SCHEDULES = `${RANK_TRACKER_SCHEDULE_GROUP}/rank-*`;

const SCHEDULER_PRINCIPAL = 'scheduler.amazonaws.com';

/** The logical id of the role only EventBridge Scheduler can assume (the rank tracker schedules' role). */
function schedulerRoleId(template: Template): string {
  const roles = template.findResources('AWS::IAM::Role');
  const principals = (id: string): unknown[] => {
    const statements = resolvePath(roles[id], ['Properties', 'AssumeRolePolicyDocument', 'Statement']);
    return (Array.isArray(statements) ? statements : []).map((statement) => resolvePath(statement, ['Principal', 'Service']));
  };
  return Object.keys(roles).find((id) => principals(id).some((principal) => principal === SCHEDULER_PRINCIPAL)) ?? '';
}

function namesOf(template: Template, type: string, property: string): string[] {
  return Object.values(template.findResources(type)).map((resource) => String(resolvePath(resource, ['Properties', property])));
}

function rankTable(template: Template): unknown {
  return Object.values(template.findResources('AWS::DynamoDB::Table', { Properties: { TableName: RANK_TABLE } }))[0];
}

/** Synthesize the SEO stack and read the rank tracking resources. */
export function synthesizeRankTrackingSnapshot(): RankTrackingSnapshot {
  const template = synthesizeSeoFeatureTemplate();
  const methods = extractApiAuthSnapshots(template).filter((method) => method.path.includes('rank-trackers'));
  const table = rankTable(template);
  const tableId = findLogicalIdByName(template, 'AWS::DynamoDB::Table', 'TableName', RANK_TABLE);
  const indexes = resolvePath(table, ['Properties', 'GlobalSecondaryIndexes']);
  const definition = stateMachineDefinitionJson(template, RANK_CHECK_STATE_MACHINE_NAME);
  return {
    template,
    routes: sortedUnique(methodRouteLabels(methods)),
    keys: keyLabels(resolvePath(table, ['Properties', 'KeySchema'])),
    indexNames: (Array.isArray(indexes) ? indexes : []).map((index) => String(resolvePath(index, ['IndexName']))),
    timeToLive: resolvePath(table, ['Properties', 'TimeToLiveSpecification']),
    routerTableActions: extractFunctionRoleActionsOn(template, SEO_ROUTER, tableId),
    jobsTableActions: extractFunctionRoleActionsOn(template, SEO_JOBS_FUNCTION_NAME, tableId),
    routerRankCheckGrants: rankCheckGrants(template, SEO_ROUTER),
    jobsRankCheckGrants: rankCheckGrants(template, SEO_JOBS_FUNCTION_NAME),
    ...sharedFunctionEnvironments(template),
    states: stateMachineStates(template, RANK_CHECK_STATE_MACHINE_NAME),
    definitionTimeoutSeconds: definition.TimeoutSeconds,
    scheduleGroups: namesOf(template, 'AWS::Scheduler::ScheduleGroup', 'Name'),
    ruleNames: namesOf(template, 'AWS::Events::Rule', 'Name'),
    routerScheduleActions: functionActionsMentioning(template, SEO_ROUTER, TRACKER_SCHEDULES),
    jobsScheduleActions: functionActionsMentioning(template, SEO_JOBS_FUNCTION_NAME, TRACKER_SCHEDULES),
    schedulerRoleJobsActions: roleActionsMentioning(template, schedulerRoleId(template), SEO_JOBS_FUNCTION_NAME),
  };
}
