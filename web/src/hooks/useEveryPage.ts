import { useEffect } from 'react';

/**
 * Loads page after page until none is left (2.45.0 wave 5): a view that joins lists, or a printed
 * report, must hold every row. `loadMore` is `undefined` once the last page is loaded; nothing is
 * asked while a page is loading or after a page failed (the view shows the error).
 */
export function useEveryPage(loadMore: (() => unknown) | undefined, busy: boolean, failed: boolean): void {
  useEffect(() => {
    if (loadMore === undefined || busy || failed) return;
    void loadMore();
  }, [loadMore, busy, failed]);
}
