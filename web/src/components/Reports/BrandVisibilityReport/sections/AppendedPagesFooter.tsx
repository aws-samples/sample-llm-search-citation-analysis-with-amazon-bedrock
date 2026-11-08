import type { AppendedPages } from '../../../../hooks/useAppendedPages';
import { LoadMoreButton } from '../../../ui/LoadMoreButton';

/** "Load more" under a table whose next pages `useAppendedPages` reads, and the error of a failed page. Screen only. */
export function AppendedPagesFooter({
  more, label
}: {
  readonly more: AppendedPages<unknown>;
  readonly label: string;
}) {
  return (
    <div className="print-hidden">
      {more.error !== null && <p role="alert" className="mt-2 text-sm text-red-700">{`Could not load more: ${more.error}`}</p>}
      <LoadMoreButton onLoadMore={more.loadMore} loading={more.loadingMore} label={label} layoutClassName="mt-3 " />
    </div>
  );
}
