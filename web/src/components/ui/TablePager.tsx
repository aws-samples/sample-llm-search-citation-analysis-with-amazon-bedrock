/**
 * The pager under a server-paged table: the rows per page and the shown
 * range on the left, Previous / "Page n of m" / Next on the right. The total
 * may be unknown (`null`); then the range and page count are left out and
 * Next follows `hasMore`.
 */
import { useId } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { integerText } from './numberFormat';

interface Props<TSize extends number> {
  /** One-based page on screen. */
  readonly page: number;
  readonly pageSize: TSize;
  readonly sizes: readonly TSize[];
  readonly totalCount: number | null;
  /** Rows on this page (the range's end on the last page). */
  readonly rowCount: number;
  readonly hasMore: boolean;
  readonly busy?: boolean;
  /** Names the page navigation for assistive technology. */
  readonly label: string;
  readonly onPage: (page: number) => void;
  readonly onPageSize: (size: TSize) => void;
  /** A note after the range (e.g. "From cache"). */
  readonly note?: ReactNode;
}

/** "1-50 of 1,234"; "No rows" for an empty page; "Rows 51-100" without a total. */
export function rangeText(page: number, pageSize: number, rowCount: number, totalCount: number | null): string {
  if (rowCount === 0) return 'No rows';
  const first = (page - 1) * pageSize + 1;
  const range = `${integerText(first)}-${integerText(first + rowCount - 1)}`;
  return totalCount === null ? `Rows ${range}` : `${range} of ${integerText(totalCount)}`;
}

/** "Page 2 of 25", or "Page 2" when the total is unknown. */
export function pageText(page: number, pageSize: number, totalCount: number | null): string {
  if (totalCount === null) return `Page ${integerText(page)}`;
  return `Page ${integerText(page)} of ${integerText(Math.max(1, Math.ceil(totalCount / pageSize)))}`;
}

export function TablePager<TSize extends number>({
  page, pageSize, sizes, totalCount, rowCount, hasMore, busy = false, label, onPage, onPageSize, note
}: Props<TSize>) {
  const sizeId = useId();
  return (
    <div className="flex flex-col gap-3 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label htmlFor={sizeId} className="text-gray-500">Rows</label>
        <select
          id={sizeId}
          value={pageSize}
          disabled={busy}
          onChange={(event) => {
            // The options are `sizes` in order.
            const picked: TSize | undefined = sizes[event.target.selectedIndex];
            if (picked !== undefined) onPageSize(picked);
          }}
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900"
        >
          {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <span className="tabular-nums">{rangeText(page, pageSize, rowCount, totalCount)}</span>
        {note}
      </div>
      <nav aria-label={label} className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="px-1 tabular-nums text-gray-700 whitespace-nowrap">{pageText(page, pageSize, totalCount)}</span>
        <Button variant="secondary" size="sm" disabled={busy || !hasMore} onClick={() => onPage(page + 1)}>Next</Button>
      </nav>
    </div>
  );
}
