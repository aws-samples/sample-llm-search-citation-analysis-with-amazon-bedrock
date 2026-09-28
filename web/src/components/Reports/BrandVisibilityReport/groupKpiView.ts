/**
 * Pure view helpers for the per-hotel (keyword group) sections of the Brand
 * Visibility report: which runs to show, what changed between them, and how
 * each figure is written.
 */
import type { GroupRun } from '../../../types/domain/groupKpiHistory';
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

/** `42.5%`, or an em dash when the value is unknown. */
export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

/** Mean rank with two decimals, or an em dash when no answer ranks the hotel. */
export function formatRank(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

function signed(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

/** A change in percentage points: `+2.5 pts`, `-1.0 pts`, or an em dash. */
export function formatPointsDelta(value: number | null): string {
  return value === null ? '—' : `${signed(value, 1)} pts`;
}

/** A change in mean rank: `+0.50` (worse) / `-0.50` (better), or an em dash. */
export function formatRankDelta(value: number | null): string {
  return value === null ? '—' : signed(value, 2);
}

/**
 * The colour a change deserves. For percentages up is good; for ranks down
 * is good (`higherIsBetter: false`). No change, or an unknown one, is neutral.
 */
export function deltaAccent(value: number | null, higherIsBetter: boolean): ReportAccent {
  const sign = Math.sign(value ?? 0);
  const direction = higherIsBetter ? sign : -sign;
  if (direction > 0) return 'positive';
  if (direction < 0) return 'negative';
  return 'neutral';
}
