interface LoadMoreButtonProps {
  /** Appends the next page; nothing is rendered without it (the last page is loaded). */
  readonly onLoadMore: (() => unknown) | undefined;
  /** A further page is being read: the button is disabled and says so. */
  readonly loading: boolean;
  /** What the button loads (e.g. "Load older content"). */
  readonly label: string;
  /** Layout classes, each followed by a space (e.g. `"mt-3 "`). */
  readonly layoutClassName?: string;
}

/** Full-width grey button below a paged list that appends its next page. */
export const LoadMoreButton = ({
  onLoadMore, loading, label, layoutClassName = ''
}: LoadMoreButtonProps) => (onLoadMore === undefined ? null : (
  <button
    type="button"
    onClick={() => { onLoadMore(); }}
    disabled={loading}
    className={`${layoutClassName}w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors`}
  >
    {loading ? 'Loading…' : label}
  </button>
));
