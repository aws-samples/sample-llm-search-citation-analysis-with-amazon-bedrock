import { accentTextClass } from './reportAccent';

interface KeywordMover {
  readonly keyword: string;
  readonly change: number;
}

interface Props {
  readonly title: string;
  readonly accent: 'positive' | 'negative';
  readonly rows: ReadonlyArray<KeywordMover>;
  /** Copy shown instead of the list when no keyword moved in this direction. */
  readonly emptyMessage: string;
}

/**
 * One side of an "improvers vs decliners" pair: a titled card listing
 * keywords with their signed score change. Used by the Brand Visibility
 * movers panel and the Executive Summary wins/gaps panel.
 */
export function MoverColumn({
  title,
  accent,
  rows,
  emptyMessage,
}: Props) {
  if (rows.length === 0) {
    return (
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
          {title}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{emptyMessage}</p>
      </div>
    );
  }

  const accentClass = accentTextClass(accent);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 avoid-break-inside">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
        {title}
      </h3>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.keyword}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="text-gray-700 dark:text-gray-300 truncate">
              {row.keyword}
            </span>
            <span className={`font-mono font-semibold flex-shrink-0 ${accentClass}`}>
              {row.change > 0 ? '+' : ''}
              {row.change.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
