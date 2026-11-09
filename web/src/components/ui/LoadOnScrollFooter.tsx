import { useLoadOnScroll } from './useLoadOnScroll';

interface LoadOnScrollFooterProps {
  /** Shows or fetches the next batch; called on scroll and by the button. */
  readonly onLoadMore: () => void;
  /** Whether there is anything left to show or fetch. */
  readonly hasMore: boolean;
  /** A batch is being fetched. */
  readonly loading: boolean;
  /** The last fetch failed: nothing loads on its own until the reader asks again. */
  readonly failed?: boolean;
  /** What changes when a batch arrives (e.g. the number of rows shown). */
  readonly watch: unknown;
  /** The end-of-list line, e.g. "All 83 keywords are shown." */
  readonly doneLabel: string;
}

/**
 * The end of a list that grows as the reader scrolls: an invisible marker
 * that asks for the next batch as it nears the screen, a polite live message
 * while loading, and a "Load more" button for keyboard users, failed fetches
 * and browsers without IntersectionObserver.
 */
export function LoadOnScrollFooter({
  onLoadMore, hasMore, loading, failed = false, watch, doneLabel
}: LoadOnScrollFooterProps) {
  const sentinelRef = useLoadOnScroll(onLoadMore, hasMore && !loading && !failed, watch);
  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
      <p className="text-sm text-gray-500" aria-live="polite">
        {loading ? 'Loading more…' : !hasMore && doneLabel}
      </p>
      {hasMore && !loading && (
        <button
          type="button"
          onClick={onLoadMore}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-500"
        >
          {failed ? 'Try again' : 'Load more'}
        </button>
      )}
    </div>
  );
}
