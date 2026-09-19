import type {
  HistoricalTrendsResponse, TrendDataPoint 
} from '../../../../types';
import {
  ReportSection,
  ReportTable,
  type ReportTableColumn,
  gateSection,
  sampleEvenly,
} from '../../layout';

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const MAX_ROWS = 14;

const COLUMNS: ReadonlyArray<ReportTableColumn<TrendDataPoint>> = [
  {
    header: 'Period',
    cellClassName: 'font-mono text-xs',
    render: (point) => point.period,
  },
  {
    header: 'Score',
    render: (point) => point.visibility_score.toFixed(1),
  },
  {
    header: 'Best rank',
    render: (point) => point.best_rank ?? '—',
  },
  {
    header: 'Mentions',
    render: (point) => point.total_mentions,
  },
  {
    header: 'Providers',
    render: (point) => point.provider_count,
  },
];

/**
 * Sampled trend history for the per-keyword report. The raw `trend_data`
 * can hold up to 30 rows for a 30-day window; printing all 30 wastes a
 * full page on a near-flat curve. Sampling evenly to ≤14 rows keeps the
 * shape readable in print without losing inflection points.
 */
export function TrendHistorySection({
  trends, loading, error 
}: Props) {
  const gate = gateSection({
    title: 'Trend history',
    loading,
    loadingMessage: 'Loading trend history…',
    error,
    value: trends,
  });
  if (!gate.ready) return gate.placeholder;

  const points = gate.value.trend_data;
  if (points.length === 0) return null;

  const sampled = sampleEvenly(points, MAX_ROWS);

  return (
    <ReportSection
      title="Trend history"
      subtitle={`Visibility score across the last ${gate.value.days_analyzed} days. Sampled to ${sampled.length} rows for print.`}
      startNewPage
    >
      <ReportTable
        columns={COLUMNS}
        rows={sampled}
        rowKey={(point) => point.period}
      />
    </ReportSection>
  );
}
