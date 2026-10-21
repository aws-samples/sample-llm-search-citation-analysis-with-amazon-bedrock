/**
 * Stand-ins for `hooks/useGroupKpiDetail` in the specs that render the group
 * report: the keyword runs and drivers a section reads on demand answer from
 * `stubGroupDetail`. A spec opts in with
 * `vi.mock('<path>/hooks/useGroupKpiDetail', () => import('<path>/groupKpiDetail-fixtures'))`.
 */
import type {
  GroupRun, GroupRunDriver, KeywordRunHistory
} from '../../../types/domain/groupKpiHistory';
import type { ReportScope } from '../../../types';
import type { GroupKpiDetail } from './groupKpiDetail';
import {
  buildChange, buildRun
} from './groupKpiHistory-fixtures';

interface DetailState {
  keywords: readonly KeywordRunHistory[];
  drivers: GroupKpiDetail['drivers'];
  loading: boolean;
  error: string | null;
}

const DETAIL_STATE: DetailState = {
  keywords: [],
  drivers: [],
  loading: false,
  error: null,
};

/** What the on-demand reads answer from now on: `detail`, still loading, or failed with `error`. */
export function stubGroupDetail(detail: GroupKpiDetail, state: {
  loading?: boolean;
  error?: string | null 
} = {}): void {
  DETAIL_STATE.keywords = detail.keywords;
  DETAIL_STATE.drivers = detail.drivers;
  DETAIL_STATE.loading = state.loading ?? false;
  DETAIL_STATE.error = state.error ?? null;
}

/** `useKeywordRuns`: the stubbed runs of `keyword`. */
export function useKeywordRuns(_scope: ReportScope, _days: number, keyword: string | null) {
  return {
    history: DETAIL_STATE.keywords.find((entry) => entry.keyword === keyword) ?? null,
    loading: DETAIL_STATE.loading,
    error: DETAIL_STATE.error,
  };
}

/** `useRunDrivers`: the stubbed drivers of `run`. */
export function useRunDrivers(_scope: ReportScope, run: string) {
  const drivers: GroupRunDriver[] | null = DETAIL_STATE.drivers.find((entry) => entry.timestamp === run)?.drivers ?? null;
  return {
    drivers,
    loading: DETAIL_STATE.loading,
    error: DETAIL_STATE.error,
  };
}

/** The timestamp of the `index`-th daily run of September 2026. */
export function dailyRun(index: number): string {
  return new Date(Date.UTC(2026, 8, 1 + index, 6)).toISOString();
}

/** `count` + 1 daily group runs: the first is the baseline, each later one compared with the run before it. */
export function comparedRunSeries(count: number): GroupRun[] {
  return Array.from({ length: count + 1 }, (_unused, index) => buildRun({
    timestamp: dailyRun(index),
    change: index === 0 ? null : buildChange({ previous_timestamp: dailyRun(index - 1) }),
  }));
}
