import { useSyncExternalStore } from 'react';

/** Tailwind's `md` and `2xl` breakpoints, where the Groups and Added columns appear (`keywordTableColumns.ts`). */
const GROUPS_COLUMN_MEDIA = '(min-width: 768px)';
const ADDED_COLUMN_MEDIA = '(min-width: 1536px)';

function subscribe(onChange: () => void): () => void {
  const queries = [GROUPS_COLUMN_MEDIA, ADDED_COLUMN_MEDIA].map((query) => window.matchMedia(query));
  queries.forEach((query) => query.addEventListener('change', onChange));
  return () => queries.forEach((query) => query.removeEventListener('change', onChange));
}

function visibleOptionalColumns(): number {
  return [GROUPS_COLUMN_MEDIA, ADDED_COLUMN_MEDIA].filter((query) => window.matchMedia(query).matches).length;
}

/**
 * How many columns the keyword table shows at the current width, for the
 * full-width edit and group rows. A `colSpan` wider than the visible columns
 * adds an empty column to a fixed-layout table and squeezes the others.
 */
export function useKeywordColumnCount(showMarket: boolean): number {
  const optional = useSyncExternalStore(subscribe, visibleOptionalColumns, () => 0);
  // Select, keyword, status and actions are always shown.
  return 4 + (showMarket ? 1 : 0) + optional;
}
