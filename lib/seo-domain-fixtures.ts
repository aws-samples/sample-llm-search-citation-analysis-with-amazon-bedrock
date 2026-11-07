import type { Template } from 'aws-cdk-lib/assertions';
import {
  extractApiAuthSnapshots,
  findLogicalIdByName,
  methodRouteLabels,
  resolvePath,
  sortedUnique,
} from './citation-analysis-stack-fixtures';
import { SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE, SEO_DOMAIN_SNAPSHOTS_TABLE } from './constructs/seo-domain';
import { SEO_JOBS_FUNCTION_NAME } from './seo-stack';
import {
  functionActionsMentioning,
  ruleScheduleAndInput,
  sharedFunctionEnvironments,
  stateMachineStates,
  synthesizeSeoFeatureTemplate,
} from './seo-feature-fixtures';
import { SEO_ROUTER } from './seo-stack-fixtures';

/** What the Domain feature adds to the SEO stack, as synthesized. */
export interface SeoDomainSnapshot {
  template: Template;
  routes: string[];
  /** The snapshots table's key schema and TTL. */
  tableKeys: unknown;
  tableTimeToLive: unknown;
  /** The state machine's states, by name (the Map's item processor flattened in). */
  states: Record<string, unknown>;
  routerEnv: Record<string, unknown>;
  jobsEnv: Record<string, unknown>;
  /** Every action the router / jobs roles hold on the snapshots table, sorted. */
  routerTableActions: string[];
  jobsTableActions: string[];
  /** Every action the router holds on the state machine, and the actions on the Action Center status table. */
  routerStateMachineActions: string[];
  routerStatusTableActions: string[];
  /** The weekly rule's schedule and its target's input. */
  ruleSchedule: unknown;
  ruleInput: unknown;
}

export function synthesizeSeoDomainSnapshot(): SeoDomainSnapshot {
  const template = synthesizeSeoFeatureTemplate();
  const tableId = findLogicalIdByName(template, 'AWS::DynamoDB::Table', 'TableName', SEO_DOMAIN_SNAPSHOTS_TABLE);
  const machineId = findLogicalIdByName(
    template, 'AWS::StepFunctions::StateMachine', 'StateMachineName', SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE
  );
  const table = template.findResources('AWS::DynamoDB::Table')[tableId];
  const [rule] = Object.values(template.findResources('AWS::Events::Rule', { Properties: { Name: 'CitationAnalysis-SeoDomainSnapshotsWeekly' } }));
  return {
    template,
    routes: sortedUnique(methodRouteLabels(extractApiAuthSnapshots(template)))
      .filter((label) => /\/api\/seo\/(domains|insights)/.test(label)),
    tableKeys: resolvePath(table, ['Properties', 'KeySchema']),
    tableTimeToLive: resolvePath(table, ['Properties', 'TimeToLiveSpecification']),
    states: stateMachineStates(template, SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE),
    ...sharedFunctionEnvironments(template),
    routerTableActions: functionActionsMentioning(template, SEO_ROUTER, tableId),
    jobsTableActions: functionActionsMentioning(template, SEO_JOBS_FUNCTION_NAME, tableId),
    routerStateMachineActions: functionActionsMentioning(template, SEO_ROUTER, machineId),
    routerStatusTableActions: functionActionsMentioning(template, SEO_ROUTER, 'CitationAnalysis-RecommendationStatus'),
    ...ruleScheduleAndInput(rule),
  };
}
