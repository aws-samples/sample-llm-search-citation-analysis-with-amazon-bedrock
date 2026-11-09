import type { TrendDataPoint } from '../../../../types';
import { formatDateOnly } from '../../../../formatting/dateFormatter';
import {
  ReportSection,
  TrendPeriodTable,
  gateSection,
  type TrendSectionProps,
} from '../../layout';
import { KpiTrendPanel } from './ReportChartPanels';
import { SectionExport } from '../../scopeReport/ScopeLists';
import type { ListRequest } from '../../../../api/scopedListPages';

interface KpiHistoryProps {
  readonly title: string;
  readonly subtitle: string;
  readonly startNewPage?: boolean;
  readonly points: readonly TrendDataPoint[];
  /** The `/trends` GET the points came from: Export all exports every period of it. */
  readonly request?: ListRequest | null;
}

/** A section of the KPIs per period: the line chart of every period over the (sampled) table. */
export function KpiHistorySection({
  title, subtitle, startNewPage, points, request = null
}: KpiHistoryProps) {
  return (
    <ReportSection title={title} subtitle={subtitle} startNewPage={startNewPage}>
      <SectionExport view="trend-periods" request={request} />
      <KpiTrendPanel points={points} className="mb-4" />
      <TrendPeriodTable points={points} />
    </ReportSection>
  );
}

/**
 * The scope's KPIs per day, week or month of the trend window: a line chart
 * of every period over the table, whose rows pool every answer of the period.
 * Long windows are sampled to 14 rows (first and last period kept) until
 * "Show all periods"; the chart draws every period.
 */
export function TrendHistorySection({
  trends, loading, error, request = null
}: TrendSectionProps) {
  const gate = gateSection({
    title: 'Trend history',
    loading,
    loadingMessage: 'Loading trend history…',
    loadingShape: 'chart',
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
      request={request}
    />
  );
}
