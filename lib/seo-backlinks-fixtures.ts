import type { Template } from 'aws-cdk-lib/assertions';
import {
  extractApiAuthSnapshots,
  findFunctionRoleLogicalId,
  findStateMachineLogicalId,
  methodRouteLabels,
  resolvePath,
  sortedUnique,
} from './citation-analysis-stack-fixtures';
import {
  BACKLINK_SNAPSHOTS_STATE_MACHINE_NAME, BACKLINK_SNAPSHOTS_TABLE_NAME
} from './constructs/seo-backlinks';
import {
  roleActionsMentioning,
  sharedFunctionEnvironments,
  stateMachineRoleLogicalId,
  stateMachineStates,
  synthesizeSeoFeatureTemplate,
} from './seo-feature-fixtures';
import { SEO_ROUTER } from './seo-stack-fixtures';

/** The backlinks feature as synthesized inside the SEO stack. */
interface BacklinksSnapshot {
  /** `"<VERB> <path>"` of every backlinks method, sorted. */
  readonly routes: string[];
  readonly tableKeySchema: unknown;
  readonly tableTimeToLive: unknown;
  readonly routerEnv: Record<string, unknown>;
  readonly jobsEnv: Record<string, unknown>;
  /** The snapshot state machine's states as parsed from its definition. */
  readonly states: Record<string, unknown>;
  /** Names of the template's EventBridge rules (a Schedule, not a rule, starts the weekly snapshot). */
  readonly ruleNames: string[];
  /** Actions of the router's statements on the snapshot state machine, sorted. */
  readonly routerStateMachineActions: string[];
  /** Actions of every statement of the state machine's role, sorted. */
  readonly stateMachineRoleActions: string[];
  /** Actions of every statement of the router's role on the snapshots table, sorted. */
  readonly routerTableActions: string[];
}

/** The logical id and resource of the template's only `type` resource named `name` under `nameKey`. */
function namedResource(template: Template, type: string, nameKey: string, name: string): [string, unknown] {
  const matching = Object.entries(template.findResources(type)).filter(
    ([, resource]) => resolvePath(resource, ['Properties', nameKey]) === name
  );
  return matching[0] ?? ['', undefined];
}

export function synthesizeBacklinksSnapshot(): BacklinksSnapshot {
  const template = synthesizeSeoFeatureTemplate();
  const methods = extractApiAuthSnapshots(template).filter((method) => method.path.includes('/backlinks'));
  const [tableLogicalId, table] = namedResource(template, 'AWS::DynamoDB::Table', 'TableName', BACKLINK_SNAPSHOTS_TABLE_NAME);
  const routerRole = findFunctionRoleLogicalId(template, SEO_ROUTER);
  return {
    routes: sortedUnique(methodRouteLabels(methods)),
    tableKeySchema: resolvePath(table, ['Properties', 'KeySchema']),
    tableTimeToLive: resolvePath(table, ['Properties', 'TimeToLiveSpecification']),
    ...sharedFunctionEnvironments(template),
    states: stateMachineStates(template, BACKLINK_SNAPSHOTS_STATE_MACHINE_NAME),
    ruleNames: Object.values(template.findResources('AWS::Events::Rule')).map((rule) => String(resolvePath(rule, ['Properties', 'Name']))),
    routerStateMachineActions: roleActionsMentioning(
      template, routerRole, findStateMachineLogicalId(template, BACKLINK_SNAPSHOTS_STATE_MACHINE_NAME)
    ),
    stateMachineRoleActions: roleActionsMentioning(
      template, stateMachineRoleLogicalId(template, BACKLINK_SNAPSHOTS_STATE_MACHINE_NAME), ''
    ),
    routerTableActions: roleActionsMentioning(template, routerRole, tableLogicalId),
  };
}
