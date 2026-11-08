import {
  useEffect, useRef
} from 'react';
import type { ScopedList } from '../../hooks/useScopedList';
import { LoadMoreButton } from './LoadMoreButton';

const COUNT = new Intl.NumberFormat('en');

interface ScopedListFooterProps {
  readonly list: ScopedList<unknown>;
  /** What the rows are, plural, e.g. "keywords". */
  readonly noun: string;
  /** The button text (default "Load more <noun>"). */
  readonly label?: string;
  /**
   * An infinite list: the next page loads when the footer scrolls into view (the button stays
   * for keyboards, and for browsers without IntersectionObserver).
   */
  readonly autoLoad?: boolean;
}

/** Calls `loadMore` each time `target` scrolls into view, while there is a page to load and none is loading. */
function useLoadWhenVisible(target: React.RefObject<HTMLDivElement | null>, loadMore: (() => unknown) | undefined, enabled: boolean): void {
  useEffect(() => {
    const element = target.current;
    if (!enabled || loadMore === undefined || element === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, loadMore, enabled]);
}

/** "Showing 100 of 5,000 keywords" while fewer rows than the total are loaded; `null` otherwise. */
function shownOfTotal(list: ScopedList<unknown>, noun: string): string | null {
  const shown = list.items.length;
  if (list.total === null || list.total <= shown) return null;
  return `Showing ${COUNT.format(shown)} of ${COUNT.format(list.total)} ${noun}`;
}

/**
 * Below a paged scoped list: how many rows of the total are shown, the "Load more" button while
 * pages are left, a page error, and a note when an expired cursor made the list start over.
 * Screen only (`print-hidden`): a printed report shows the rows that are loaded.
 */
export function ScopedListFooter({
  list, noun, label, autoLoad = false
}: ScopedListFooterProps) {
  const footerRef = useRef<HTMLDivElement | null>(null);
  useLoadWhenVisible(footerRef, list.loadMore, autoLoad && !list.loadingMore && list.error === null);
  const counted = shownOfTotal(list, noun);
  if (counted === null && list.loadMore === undefined && list.error === null && !list.restarted) return null;
  return (
    <div ref={footerRef} className="print-hidden mt-3 space-y-2">
      {list.restarted && (
        <p role="note" className="text-xs text-gray-500">
          The list changed while it was being read (new figures or keyword changes), so it was loaded again from the start.
        </p>
      )}
      {counted !== null && <p className="text-xs text-gray-500">{counted}</p>}
      {list.error !== null && <p role="alert" className="text-xs text-red-700">{list.error}</p>}
      <LoadMoreButton onLoadMore={list.loadMore} loading={list.loadingMore} label={label ?? `Load more ${noun}`} />
    </div>
  );
}
