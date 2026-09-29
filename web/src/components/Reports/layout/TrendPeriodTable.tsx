import type { TrendDataPoint } from '../../../types';
import type { KpiId } from '../../../constants/kpiDefinitions';
import { formatKpi } from '../../../formatting/kpiFormatter';
import { kpiColumn } from './kpiColumn';
import {
  ReportTable, type ReportTableColumn
} from './ReportTable';
import { sampleEvenly } from './sampleEvenly';

/** The most periods a printed table lists; longer series are sampled evenly, keeping the first and last period. */
export const MAX_TREND_ROWS = 14;

/** The KPIs of each period, in column order. */
export const TREND_PERIOD_KPIS: readonly KpiId[] = [
  'answers',
  'mention_rate',
  'share_of_voice',
  'visibility_score',
  'average_position',
  'citation_rate',
];

const COLUMNS: ReadonlyArray<ReportTableColumn<TrendDataPoint>> = [
  {
    header: 'Period',
    // Stryker disable next-line StringLiteral: Tailwind-only cell styling
    cellClassName: 'font-mono text-xs whitespace-nowrap',
    render: (point) => point.period,
  },
  {
    header: 'Runs',
    info: 'Analysis runs in the period. Every answer of every run in the period is pooled into its KPIs.',
    render: (point) => point.runs,
  },
  ...TREND_PERIOD_KPIS.map((id) => kpiColumn<TrendDataPoint>(id, (point) => formatKpi(id, point.kpis[id]))),
];

interface Props {readonly points: readonly TrendDataPoint[];}

/** One row per day, week or month of a `/trends` series: its runs and the KPIs over every answer in it. */
export function TrendPeriodTable({ points }: Props) {
  return (
    <ReportTable
      columns={COLUMNS}
      rows={sampleEvenly(points, MAX_TREND_ROWS)}
      // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
      rowKey={(point) => point.period}
    />
  );
}
