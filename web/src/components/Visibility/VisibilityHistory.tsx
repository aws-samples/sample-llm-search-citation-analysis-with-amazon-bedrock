import type { HistoricalTrendsResponse } from '../../types';
import { formatDateOnly } from '../../formatting/dateFormatter';
import {
  KPI_TREND_INFO, TrendPeriodChart
} from '../Reports/BrandVisibilityReport/sections/ReportChartPanels';
import { OverviewPanel } from './OverviewPanel';
import { HistoryChartSkeleton } from './VisibilitySkeletons';

export type HistoryRangeDays = 7 | 30 | 90;
const HISTORY_RANGES: readonly HistoryRangeDays[] = [7, 30, 90];

export const HISTORY_TITLE = 'KPI history';

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly error: string | null;
  readonly rangeDays: HistoryRangeDays;
  readonly onRangeChange: (days: HistoryRangeDays) => void;
  /** The trends request is in flight; with no trends yet, a chart-sized placeholder holds the panel's height. */
  readonly loading?: boolean;
}

function RangeButton({
  days, pressed, onSelect
}: {
  readonly days: HistoryRangeDays;
  readonly pressed: boolean;
  readonly onSelect: (days: HistoryRangeDays) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(days)}
      aria-pressed={pressed}
      // Stryker disable next-line StringLiteral,ConditionalExpression: Tailwind-only styling; aria-pressed carries the selected range
      className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${pressed ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'}`}
    >
      {days} days
    </button>
  );
}

function RangeButtons({
  rangeDays, onRangeChange
}: Pick<Props, 'rangeDays' | 'onRangeChange'>) {
  return (
    <fieldset className="flex gap-1 border-0 p-0 m-0">
      <legend className="sr-only">History range</legend>
      {HISTORY_RANGES.map((days) => (
        <RangeButton key={days} days={days} pressed={rangeDays === days} onSelect={onRangeChange} />
      ))}
    </fieldset>
  );
}

function TrendChart({ trends }: { readonly trends: HistoricalTrendsResponse }) {
  const period = trends.period_type;
  return (
    <>
      <TrendPeriodChart points={trends.trend_data} />
      <p className="text-xs text-gray-500">
        {`Mention rate, share of voice, visibility score and citation rate per ${period} over the last ${trends.days_analyzed} days `
          + `(since ${formatDateOnly(trends.since)}). A ${period} without answers is a gap.`}
      </p>
    </>
  );
}

function HistoryBody({
  trends, error, loading = false
}: Pick<Props, 'trends' | 'error' | 'loading'>) {
  if (loading && trends === null) return <HistoryChartSkeleton />;
  if (error !== null) return <p className="text-sm text-amber-800">{`History unavailable: ${error}`}</p>;
  if (trends === null || trends.trend_data.length === 0) {
    return <p className="text-sm text-gray-500">No analysis runs in this range yet.</p>;
  }
  return <TrendChart trends={trends} />;
}

/** The headline KPIs per period over the chosen range as lines, with how they are drawn in a tooltip. */
export function VisibilityHistory({
  trends, error, rangeDays, onRangeChange, loading
}: Props) {
  return (
    <OverviewPanel
      title={HISTORY_TITLE}
      info={KPI_TREND_INFO}
      actions={<RangeButtons rangeDays={rangeDays} onRangeChange={onRangeChange} />}
    >
      <HistoryBody trends={trends} error={error} loading={loading} />
    </OverviewPanel>
  );
}
