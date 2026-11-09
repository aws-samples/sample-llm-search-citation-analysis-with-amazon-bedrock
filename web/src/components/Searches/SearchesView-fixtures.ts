import { screen } from '@testing-library/react';
import { buildSearch } from '../../formatting/searchSummary-fixtures';
import type { Search } from '../../types';

/** The "Load more" button at the end of the list, or `null` when everything is shown. */
export function queryLoadMoreElement(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Load more' });
}

/** One run for each of `count` distinct keywords ("keyword 1" newest), so the table has `count` rows. */
export function buildKeywordRuns(count: number): Search[] {
  return Array.from({ length: count }, (_, index) => buildSearch({
    keyword: `keyword ${index + 1}`,
    timestamp: new Date(Date.UTC(2026, 8, 18, 10) - index * 60_000).toISOString(),
  }));
}

/** The keyword rows the table shows. */
export function shownKeywordRows(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: /^keyword \d+$/ });
}
