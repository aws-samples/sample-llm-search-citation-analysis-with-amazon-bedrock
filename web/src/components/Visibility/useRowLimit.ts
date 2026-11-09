import { useState } from 'react';

/** Rows a long Visibility table shows before "Show all". */
export const VISIBILITY_ROW_LIMIT = 15;

/** The rows on screen, and whether the full list is open. */
interface RowLimit<T> {
  readonly visible: readonly T[];
  readonly showAll: boolean;
  /** More rows exist than the limit, so the toggle is worth showing. */
  readonly limited: boolean;
  readonly toggle: () => void;
}

/**
 * Keeps a long table to its first `limit` rows until the reader asks for the
 * rest, so the panels under it stay within reach. Sort before calling it.
 */
export function useRowLimit<T>(rows: readonly T[], limit: number = VISIBILITY_ROW_LIMIT): RowLimit<T> {
  const [showAll, setShowAll] = useState(false);
  const limited = rows.length > limit;
  return {
    visible: showAll || !limited ? rows : rows.slice(0, limit),
    showAll,
    limited,
    toggle: () => { setShowAll((previous) => !previous); },
  };
}
