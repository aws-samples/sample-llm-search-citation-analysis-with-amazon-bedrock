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
import { RANK_CHECK_STATE_MACHINE_NAME } from './constructs/seo-rank-tracking';
import { SEO_JOBS_FUNCTION_NAME } from './seo-stack';
import {
  keyLabels,
  ruleScheduleAndInput,
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
  /** The schedule rule's expression and target input. */
  ruleSchedule: unknown;
  ruleInput: unknown;
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
  const [rule] = Object.values(template.findResources('AWS::Events::Rule', {
    Properties: { Name: 'CitationAnalysis-SeoRankTrackingTick' },
  }));
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
    ...ruleScheduleAndInput(rule),
  };
}
