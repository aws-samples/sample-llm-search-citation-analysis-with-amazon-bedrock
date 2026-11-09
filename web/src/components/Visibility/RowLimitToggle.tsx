import type { ReactNode } from 'react';
import type { RowLimit } from './useRowLimit';

interface Props {
  /** The table's `useRowLimit` state. */
  readonly rowLimit: RowLimit<unknown>;
  /** Rows in the full list. */
  readonly total: number;
  /** What a row is, plural ("keywords", "brands"). */
  readonly noun: string;
  /** The paged list's footer (Load more), shown once the full list is open or nothing is cut. */
  readonly footer?: ReactNode;
}

/**
 * "Showing 15 of 83 keywords · Show all 83" under a long table, or "Show the
 * top 15" once it is open, followed by the paged list's footer when every
 * loaded row is on screen.
 */
export function RowLimitToggle({
  rowLimit, total, noun, footer
}: Props) {
  const {
    limit, limited, showAll, toggle
  } = rowLimit;
  return (
    <>
      {limited && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>{showAll ? `All ${total} ${noun}.` : `Showing ${limit} of ${total} ${noun}.`}</span>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={showAll}
            className="rounded-sm text-sm font-medium text-blue-700 hover:text-blue-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-gray-100"
          >
            {showAll ? `Show the top ${limit}` : `Show all ${total} ${noun}`}
          </button>
        </div>
      )}
      {(!limited || showAll) && footer}
    </>
  );
}
