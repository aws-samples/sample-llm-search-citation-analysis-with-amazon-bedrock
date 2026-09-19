import {
  accentTextClass, type ReportAccent 
} from './reportAccent';

interface Props {
  /** Small uppercase caption above the figure (e.g. "Share of voice"). */
  readonly label: string;
  /** The headline figure. Numbers render exactly like their string form. */
  readonly value: string | number;
  /** Optional one-line context under the figure (e.g. "Competitor avg: 42.0"). */
  readonly footnote?: string;
  readonly accent?: ReportAccent;
}

/**
 * Headline stat card used by every report's "Headline" section: a caption,
 * a large accent-coloured figure, and an optional footnote. Cards are laid
 * out with <ReportStatGrid /> so the print output keeps a consistent rhythm
 * across all five report types.
 */
export function ReportStatCard({
  label,
  value,
  footnote,
  accent = 'neutral',
}: Props) {
  const accentClass = accentTextClass(accent);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className={`text-2xl font-semibold mt-1 ${accentClass}`}>{value}</p>
      {footnote !== undefined && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{footnote}</p>
      )}
    </div>
  );
}
