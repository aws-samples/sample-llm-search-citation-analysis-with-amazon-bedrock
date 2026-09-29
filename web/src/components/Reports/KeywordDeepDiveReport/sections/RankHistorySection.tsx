import type { HistoricalTrendsResponse } from '../../../../types';
import {
  ReportSection,
  ReportSectionPlaceholder,
  TrendPeriodTable,
  pendingSectionPlaceholder,
} from '../../layout';

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const TITLE = 'KPI history';

function subtitleFor(trends: HistoricalTrendsResponse | null): string {
  const period = trends?.period_type ?? 'day';
  const days = trends?.days_analyzed ?? 30;
  return `How this keyword's KPIs moved per ${period} over the last ${days} days.`;
}

/**
 * This keyword's KPIs per period of the trend window, as a table rather
 * than a chart: tables print reliably to PDF and are easier to scan on
 * paper. Long windows are sampled to at most 14 rows, keeping the first and
 * last period.
 */
export function RankHistorySection({
  trends, loading, error 
}: Props) {
  const pending = pendingSectionPlaceholder({
    title: TITLE,
    loading,
    loadingMessage: 'Loading trend data…',
    loadingSubtitle: subtitleFor(trends),
    error,
  });
  if (pending) return pending;

  const points = trends?.trend_data ?? [];
  if (points.length === 0) {
    return (
      <ReportSectionPlaceholder
        title={TITLE}
        variant="empty"
        message="No history yet — run an analysis of this keyword to start one."
      />
    );
  }

  return (
    <ReportSection title={TITLE} subtitle={subtitleFor(trends)}>
      <TrendPeriodTable points={points} />
    </ReportSection>
  );
}
