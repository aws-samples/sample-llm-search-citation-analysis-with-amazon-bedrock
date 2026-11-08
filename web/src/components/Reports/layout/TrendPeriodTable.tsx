import { useState } from 'react';
import type { TrendDataPoint } from '../../../types';
import type { KpiId } from '../../../constants/kpiDefinitions';
import { formatKpi } from '../../../formatting/kpiFormatter';
import { kpiColumn } from './kpiColumn';
import {
  ReportTable, type ReportTableColumn
} from './ReportTable';
import { sampleEvenly } from './sampleEvenly';

/** The most periods the table lists until "Show all periods"; longer series are sampled evenly, keeping the first and last period. */
export const MAX_TREND_ROWS = 14;

/** The KPIs of each period, in column order; built per render (not at import) so the specs exercise every column. */
function trendPeriodKpis(): readonly KpiId[] {
  return ['answers', 'mention_rate', 'share_of_voice', 'visibility_score', 'average_position', 'citation_rate'];
}

function trendColumns(kpis: readonly KpiId[]): ReadonlyArray<ReportTableColumn<TrendDataPoint>> {
  return [
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
    ...kpis.map((id) => kpiColumn<TrendDataPoint>(id, (point) => formatKpi(id, point.kpis[id]))),
  ];
}

interface Props {
  readonly points: readonly TrendDataPoint[];
  /** The KPI columns after the runs (the visibility set by default). */
  readonly kpis?: readonly KpiId[];
}

/**
 * One row per day, week or month of a `/trends` series: its runs and the KPIs over every answer in
 * it. A long series lists 14 evenly sampled periods until "Show all periods" lists every one.
 */
export function TrendPeriodTable({
  points, kpis
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const sampled = points.length > MAX_TREND_ROWS;
  return (
    <>
      <ReportTable
        columns={trendColumns(kpis ?? trendPeriodKpis())}
        rows={showAll ? points : sampleEvenly(points, MAX_TREND_ROWS)}
        // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
        rowKey={(point) => point.period}
      />
      {sampled && (
        <button
          type="button"
          onClick={() => setShowAll((shown) => !shown)}
          className="print-hidden mt-2 text-sm font-medium text-gray-700 underline hover:text-gray-900 dark:text-gray-300"
        >
          {showAll ? `Show ${MAX_TREND_ROWS} sampled periods` : `Show all ${points.length} periods`}
        </button>
      )}
    </>
  );
}
