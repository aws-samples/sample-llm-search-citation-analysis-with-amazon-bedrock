import type { KeywordResearchItem } from '../../types';

/**
 * Client-side filters for the History tab. They work on the runs already
 * loaded; "Load older research" still pages the API unchanged.
 */

export type HistoryTypeFilter = 'all' | KeywordResearchItem['type'];

/** Status groups shown to the user; `failed` holds both failed and partial runs (both can be retried). */
export type HistoryStatusFilter = 'all' | 'completed' | 'running' | 'failed';

export interface HistoryFilters {
  type: HistoryTypeFilter;
  status: HistoryStatusFilter;
  /** Show failed runs older than `STALE_FAILURE_DAYS` under the "All" status. */
  showStaleFailures: boolean;
}

export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  type: 'all',
  status: 'all',
  showStaleFailures: false,
};

/** A failed run older than this is collapsed by default: the backend sweep fails stranded runs months later. */
export const STALE_FAILURE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export const TYPE_FILTER_LABELS: Record<KeywordResearchItem['type'], string> = {
  expansion: 'Expansion',
  competitor: 'Competitor',
  agent: 'Agent',
};

export const STATUS_FILTER_OPTIONS: {
  value: HistoryStatusFilter;
  label: string 
}[] = [
  {
    value: 'all',
    label: 'All' 
  },
  {
    value: 'completed',
    label: 'Completed' 
  },
  {
    value: 'running',
    label: 'Running' 
  },
  {
    value: 'failed',
    label: 'Failed or partial' 
  },
];

/** Rows from before the status field existed count as completed. */
export function statusGroupOf(item: KeywordResearchItem): Exclude<HistoryStatusFilter, 'all'> {
  switch (item.status) {
    case 'pending':
    case 'running':
    case 'processing':
      return 'running';
    case 'partial':
    case 'failed':
      return 'failed';
    default:
      return 'completed';
  }
}

/** A run the backend marked failed more than `STALE_FAILURE_DAYS` ago. Partial runs carry results and stay. */
export function isStaleFailure(item: KeywordResearchItem, now: number): boolean {
  if (item.status !== 'failed') return false;
  const created = Date.parse(item.created_at);
  return !Number.isNaN(created) && now - created > STALE_FAILURE_DAYS * DAY_MS;
}

/** Stale failures are hidden only under "All"; picking the failed group shows every failure. */
function hidesStaleFailures(filters: HistoryFilters): boolean {
  return filters.status === 'all' && !filters.showStaleFailures;
}

export function matchesHistoryFilters(item: KeywordResearchItem, filters: HistoryFilters, now: number): boolean {
  if (filters.type !== 'all' && item.type !== filters.type) return false;
  if (filters.status !== 'all' && statusGroupOf(item) !== filters.status) return false;
  return !(hidesStaleFailures(filters) && isStaleFailure(item, now));
}

export function filterHistory(
  history: KeywordResearchItem[], filters: HistoryFilters, now: number
): KeywordResearchItem[] {
  return history.filter((item) => matchesHistoryFilters(item, filters, now));
}

/** Stale failures of the selected type that the default view hides (0 when nothing is hidden). */
export function countHiddenStaleFailures(
  history: KeywordResearchItem[], filters: HistoryFilters, now: number
): number {
  if (filters.status !== 'all') return 0;
  return history.filter((item) =>
    (filters.type === 'all' || item.type === filters.type) && isStaleFailure(item, now)
  ).length;
}

/** The run types present in the loaded history, in display order. */
export function presentTypes(history: KeywordResearchItem[]): KeywordResearchItem['type'][] {
  const types = Object.keys(TYPE_FILTER_LABELS) as KeywordResearchItem['type'][];
  return types.filter((type) => history.some((item) => item.type === type));
}
