import type {
  HistoricalTrendsResponse, TrendDataPoint 
} from '../../../../types';
import {
  ReportSection,
  ReportSectionPlaceholder,
  ReportTable,
  type ReportTableColumn,
  pendingSectionPlaceholder,
  sampleEvenly,
} from '../../layout';

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * 30-day visibility-score history. Renders as a compact table rather than a
 * chart for the first version: tables print reliably to PDF without canvas
 * sizing surprises and are easier to scan in a printed report.
 *
 * We sample at most 14 evenly spaced points so the table fits on a page
 * even for accounts with many analysis runs per day. The summary line above
 * the table preserves the exact min/max/average so detail isn't lost.
 */
const MAX_ROWS = 14;
const SUBTITLE = "How this keyword's visibility has moved over the last 30 days.";

const COLUMNS: ReadonlyArray<ReportTableColumn<TrendDataPoint>> = [
  {
    header: 'Period',
    render: (point) => point.period,
  },
  {
    header: 'Score',
    cellClassName: 'font-medium',
    render: (point) => point.visibility_score.toFixed(1),
  },
  {
    header: 'Mentions',
    render: (point) => point.total_mentions,
  },
  {
    header: 'Best rank',
    render: (point) => point.best_rank ?? '—',
  },
  {
    header: 'Providers',
    render: (point) => point.provider_count,
  },
];

export function RankHistorySection({
  trends, loading, error 
}: Props) {
  const pending = pendingSectionPlaceholder({
    title: 'Rank history',
    loading,
    loadingMessage: 'Loading trend data…',
    loadingSubtitle: SUBTITLE,
    error,
  });
  if (pending) return pending;

  const trendData = trends?.trend_data ?? [];
  if (trendData.length === 0) {
    return (
      <ReportSectionPlaceholder
        title="Rank history"
        variant="empty"
        message="Not enough history yet — at least two analysis runs are needed to draw a trend."
      />
    );
  }

  const sampled = sampleEvenly(trendData, MAX_ROWS);
  const summary = trends?.summary;

  return (
    <ReportSection title="Rank history" subtitle={SUBTITLE}>
      {summary && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Average score{' '}
          <span className="font-medium text-gray-900 dark:text-white">
            {summary.average_score.toFixed(1)}
          </span>
          {' · '}
          Range{' '}
          <span className="font-medium text-gray-900 dark:text-white">
            {summary.min_score.toFixed(1)}–{summary.max_score.toFixed(1)}
          </span>
        </p>
      )}
      <ReportTable
        columns={COLUMNS}
        rows={sampled}
        rowKey={(point) => point.period}
      />
    </ReportSection>
  );
}
