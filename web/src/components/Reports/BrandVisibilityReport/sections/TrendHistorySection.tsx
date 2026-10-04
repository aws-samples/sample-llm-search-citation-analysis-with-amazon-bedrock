import type { TrendDataPoint } from '../../../../types';
import { formatDateOnly } from '../../../../formatting/dateFormatter';
import {
  ReportSection,
  TrendPeriodTable,
  gateSection,
  type TrendSectionProps,
} from '../../layout';
import { KpiTrendPanel } from './ReportChartPanels';

interface KpiHistoryProps {
  readonly title: string;
  readonly subtitle: string;
  readonly startNewPage?: boolean;
  readonly points: readonly TrendDataPoint[];
}

/** A section of the KPIs per period: the line chart of every period over the (sampled) table. */
export function KpiHistorySection({
  title, subtitle, startNewPage, points
}: KpiHistoryProps) {
  return (
    <ReportSection title={title} subtitle={subtitle} startNewPage={startNewPage}>
      <KpiTrendPanel points={points} className="mb-4" />
      <TrendPeriodTable points={points} />
    </ReportSection>
  );
}

/**
 * The scope's KPIs per day, week or month of the trend window: a line chart
 * of every period over the table, whose rows pool every answer of the period.
 * Long windows are sampled to at most 14 rows so the table fits one printed
 * page, keeping the first and last period; the chart draws every period.
 */
export function TrendHistorySection({
  trends, loading, error 
}: TrendSectionProps) {
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
    <KpiHistorySection
      title="Trend history"
      subtitle={`Every KPI per ${period} since ${formatDateOnly(since)}, over every answer in the ${period}.`}
      startNewPage
      points={points}
    />
  );
}
