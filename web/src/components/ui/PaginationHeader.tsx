import {
  pageWindow, SHOW_ALL_ITEMS
} from './pagination';

const DEFAULT_PAGE_SIZES: readonly number[] = [25, 50, 100];

const PAGE_BUTTON_CLASS = 'px-2 py-1 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50 text-xs sm:text-sm';

export interface PaginationHeaderProps {
  /** One-based current page. */
  readonly page: number;
  /** Items per page, or `SHOW_ALL_ITEMS` for a single page holding everything. */
  readonly pageSize: number;
  readonly total: number;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly pageSizeOptions?: readonly number[];
  /** Prefix of the page-size select's id and name: `citations` gives `citations-items-per-page`. */
  readonly idPrefix: string;
  /** Accessible name of the pager landmark, e.g. "Citations pagination". */
  readonly label: string;
}

interface PageButtonProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
}

const PageButton = ({
  label, onClick, disabled
}: PageButtonProps) => (
  <button onClick={onClick} disabled={disabled} className={PAGE_BUTTON_CLASS}>{label}</button>
);

/**
 * Header of a paginated table: the page-size select, the visible range and,
 * when there is more than one page, a First / Prev / Next / Last pager.
 */
export const PaginationHeader = ({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  idPrefix,
  label,
}: PaginationHeaderProps) => {
  const {
    showAll, totalPages, startIndex, endIndex
  } = pageWindow(total, page, pageSize);
  const selectId = `${idPrefix}-items-per-page`;

  return (
    <div className="p-3 sm:p-4 border-b border-gray-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
        <div className="flex items-center gap-2">
          <label htmlFor={selectId} className="text-gray-500">Show:</label>
          <select
            id={selectId}
            name={selectId}
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="px-2 sm:px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
            <option value={SHOW_ALL_ITEMS}>All ({total})</option>
          </select>
          <span className="text-gray-500 text-xs sm:text-sm">
            {showAll ? `All ${total}` : `${startIndex + 1}-${Math.min(endIndex, total)} of ${total}`}
          </span>
        </div>
        {totalPages > 1 && (
          <nav aria-label={label} className="flex items-center gap-1 overflow-x-auto">
            <PageButton label="First" onClick={() => onPageChange(1)} disabled={page === 1} />
            <PageButton label="Prev" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} />
            <span className="px-2 sm:px-3 py-1 text-gray-700 text-xs sm:text-sm">{page}/{totalPages}</span>
            <PageButton label="Next" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} />
            <PageButton label="Last" onClick={() => onPageChange(totalPages)} disabled={page === totalPages} />
          </nav>
        )}
      </div>
    </div>
  );
};
