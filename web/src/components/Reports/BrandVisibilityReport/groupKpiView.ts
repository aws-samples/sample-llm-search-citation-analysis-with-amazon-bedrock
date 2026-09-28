/**
 * Pure view helpers for the per-group sections of the Brand Visibility
 * report: which runs to show, what changed between them, and how each
 * change is coloured. Values are written by `formatting/kpiFormatter`.
 */
import type {
  GroupRun, KpiTrend
} from '../../../types/domain/groupKpiHistory';
import type { KpiId } from '../../../constants/kpiDefinitions';
import type { ReportAccent } from '../layout';

/** The runs covering at least half of the group's keywords — the ones compared with each other. */
export function groupRuns(runs: readonly GroupRun[]): GroupRun[] {
  return runs.filter((run) => run.is_group_run);
}

/** The newest group run, or `null` when the window holds none. */
export function latestGroupRun(runs: readonly GroupRun[]): GroupRun | null {
  const compared = groupRuns(runs);
  return compared.length > 0 ? compared[compared.length - 1] : null;
}

/** A provider whose answering model differs from the previous group run. */
export interface ModelChange {
  readonly timestamp: string;
  readonly provider: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
}

function sameModels(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((model, index) => model === right[index]);
}

/**
 * Where a provider started answering with other models, between consecutive
 * group runs. A provider missing from either run is not a model change.
 */
export function modelChanges(runs: readonly GroupRun[]): ModelChange[] {
  const compared = groupRuns(runs);
  return compared.slice(1).flatMap((run, index) => {
    const previous = compared[index].models;
    return Object.entries(run.models)
      .filter(([provider, models]) => provider in previous && !sameModels(previous[provider], models))
      .map(([provider, models]) => ({
        timestamp: run.timestamp,
        provider,
        from: previous[provider],
        to: models,
      }));
  });
}

/** The colour a trend deserves: improving is positive, declining negative, stable or unknown neutral. */
export function trendAccent(trend: KpiTrend | undefined): ReportAccent {
  if (trend === 'improving') return 'positive';
  if (trend === 'declining') return 'negative';
  return 'neutral';
}

/** The trend of a KPI in a group run's change; `undefined` for counts, or without a change. */
export function runTrend(run: GroupRun, id: KpiId): KpiTrend | undefined {
  const trends: Partial<Record<KpiId, KpiTrend>> | undefined = run.change?.trends;
  return trends?.[id];
}
