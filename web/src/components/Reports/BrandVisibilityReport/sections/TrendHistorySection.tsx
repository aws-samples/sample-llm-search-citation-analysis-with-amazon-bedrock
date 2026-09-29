import type { HistoricalTrendsResponse } from '../../../../types';
import { formatDateOnly } from '../../../../formatting/dateFormatter';
import {
  ReportSection,
  TrendPeriodTable,
  gateSection,
} from '../../layout';
import { KpiTrendPanel } from './ReportChartPanels';

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The scope's KPIs per day, week or month of the trend window: a line chart
 * of every period over the table, whose rows pool every answer of the period.
 * Long windows are sampled to at most 14 rows so the table fits one printed
 * page, keeping the first and last period; the chart draws every period.
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

  const {
    trend_data: points, period_type: period, since
  } = gate.value;
  if (points.length === 0) return null;

  return (
    <ReportSection
      title="Trend history"
      subtitle={`Every KPI per ${period} since ${formatDateOnly(since)}, over every answer in the ${period}.`}
      startNewPage
    >
      <KpiTrendPanel points={points} className="mb-4" />
      <TrendPeriodTable points={points} />
    </ReportSection>
  );
}
