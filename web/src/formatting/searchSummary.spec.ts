import {
  describe, expect, it
} from 'vitest';
import { summarizeSearches } from './searchSummary';
import {
  MIDDLE, NEWEST, OLDEST, UNSORTED_RUNS, buildSearch
} from './searchSummary-fixtures';

describe('summarizeSearches', () => {
  it('reports zero totals and no latest timestamp for an empty list', () => {
    expect(summarizeSearches([])).toStrictEqual({
      totalRuns: 0,
      totalCitations: 0,
      avgCitationsPerRun: 0,
      latestTimestamp: null,
      sorted: [],
    });
  });

  it('counts one run per search', () => {
    expect(summarizeSearches(UNSORTED_RUNS).totalRuns).toBe(3);
  });

  it('adds up the citations of every run', () => {
    expect(summarizeSearches(UNSORTED_RUNS).totalCitations).toBe(3);
  });

  it('averages the citations over the runs', () => {
    expect(summarizeSearches(UNSORTED_RUNS).avgCitationsPerRun).toBe(1);
  });

  it('counts a run without a citations array as zero citations', () => {
    const uncited = buildSearch({ citations: undefined });

    expect(summarizeSearches([uncited, NEWEST]).totalCitations).toBe(2);
  });

  it('orders the runs newest-first whatever order they arrive in', () => {
    expect(summarizeSearches(UNSORTED_RUNS).sorted).toStrictEqual([NEWEST, MIDDLE, OLDEST]);
  });

  it('takes the latest timestamp from the newest run, not from the first one listed', () => {
    expect(summarizeSearches(UNSORTED_RUNS).latestTimestamp).toBe('2026-03-10T09:00:00Z');
  });

  it('keeps the input order of runs that share a timestamp', () => {
    const openai = buildSearch({ provider: 'openai' });
    const claude = buildSearch({ provider: 'claude' });

    expect(summarizeSearches([openai, claude, OLDEST]).sorted).toStrictEqual([openai, claude, OLDEST]);
  });

  it('leaves the caller\'s list in its original order', () => {
    const runs = [...UNSORTED_RUNS];

    summarizeSearches(runs);

    expect(runs).toStrictEqual(UNSORTED_RUNS);
  });
});
