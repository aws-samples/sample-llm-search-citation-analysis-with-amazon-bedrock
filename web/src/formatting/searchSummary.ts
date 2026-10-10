import type { Search } from '../types';

/** Run and citation totals over a keyword's searches, with the searches newest-first. */
export interface SearchSummary {
  readonly totalRuns: number;
  readonly totalCitations: number;
  /** 0 when there are no runs. */
  readonly avgCitationsPerRun: number;
  /** Timestamp of the newest search, or null when there are none. */
  readonly latestTimestamp: string | null;
  /** The searches newest-first; searches sharing a timestamp keep their input order. */
  readonly sorted: Search[];
}

function byNewestFirst(a: Search, b: Search): number {
  return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
}

/** Summarises `searches` without reordering the caller's list. */
export function summarizeSearches(searches: readonly Search[]): SearchSummary {
  const sorted = [...searches].sort(byNewestFirst);
  const totalRuns = searches.length;
  const totalCitations = searches.reduce((sum, search) => sum + (search.citations?.length ?? 0), 0);

  return {
    totalRuns,
    totalCitations,
    avgCitationsPerRun: totalRuns > 0 ? totalCitations / totalRuns : 0,
    latestTimestamp: totalRuns > 0 ? sorted[0].timestamp : null,
    sorted,
  };
}
