interface Props {
  /** Rows in the full list. */
  readonly total: number;
  /** Rows shown while the list is collapsed. */
  readonly limit: number;
  readonly showAll: boolean;
  /** What a row is, plural ("keywords", "brands"). */
  readonly noun: string;
  readonly onToggle: () => void;
}

/** "Showing 15 of 83 keywords · Show all 83" under a long table, or "Show the top 15" once it is open. */
export function RowLimitToggle({
  total, limit, showAll, noun, onToggle
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
      <span>{showAll ? `All ${total} ${noun}.` : `Showing ${limit} of ${total} ${noun}.`}</span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={showAll}
        className="rounded text-sm font-medium text-blue-700 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-gray-100"
      >
        {showAll ? `Show the top ${limit}` : `Show all ${total} ${noun}`}
      </button>
    </div>
  );
}
