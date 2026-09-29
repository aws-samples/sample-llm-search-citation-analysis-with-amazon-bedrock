import type {
  HistoricalTrendsResponse, TrendDataPoint
} from '../../types';
import { KPI_DEFINITIONS } from '../../constants/kpiDefinitions';
import { formatKpi } from '../../formatting/kpiFormatter';
import { formatDateOnly } from '../../formatting/dateFormatter';
import { OverviewPanel } from './OverviewPanel';

export type HistoryRangeDays = 7 | 30 | 90;
export const HISTORY_RANGES: readonly HistoryRangeDays[] = [7, 30, 90];

/** The KPI the history chart plots. */
const CHARTED = KPI_DEFINITIONS.visibility_score;
const CHART_HEIGHT_PX = 180;
/** Every n-th bar carries its period under it. */
const PERIOD_LABEL_EVERY = 5;

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly error: string | null;
  readonly rangeDays: HistoryRangeDays;
  readonly onRangeChange: (days: HistoryRangeDays) => void;
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** What one bar says: its period, score, and how many runs and keywords it pools. */
function trendPointDescription(point: TrendDataPoint): string {
  const score = formatKpi('visibility_score', point.kpis.visibility_score);
  return `${point.period}: ${score} (${counted(point.runs, 'run')}, ${counted(point.keywords_with_data, 'keyword')})`;
}

/** One period's bar; a period without a score is a gap, not a zero. */
function TrendBar({
  point, showPeriod
}: {
  readonly point: TrendDataPoint;
  readonly showPeriod: boolean
}) {
  const score = point.kpis.visibility_score;
  const description = trendPointDescription(point);
  return (
    <li className="flex-1 flex flex-col items-center justify-end h-full">
      <span className="sr-only">{description}</span>
      {score === null
        ? <div aria-hidden="true" title={description} className="w-full border-b border-dashed border-gray-300" />
        : <div aria-hidden="true" title={description} className="w-full bg-blue-500 rounded-t" style={{ height: `${(score / 100) * CHART_HEIGHT_PX}px` }} />}
      {showPeriod && <div aria-hidden="true" className="text-xs text-gray-400 mt-1 transform -rotate-45">{point.period.slice(5)}</div>}
    </li>
  );
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
      <ol aria-label={`${CHARTED.label} per ${period}`} className="h-48 flex items-end gap-1 list-none p-0 m-0">
        {trends.trend_data.map((point, index) => (
          <TrendBar key={point.period} point={point} showPeriod={index % PERIOD_LABEL_EVERY === 0} />
        ))}
      </ol>
      <p className="text-xs text-gray-500">
        {`${CHARTED.label} per ${period} over the last ${trends.days_analyzed} days (since ${formatDateOnly(trends.since)}). `
          + `A ${period} without answers is a gap.`}
      </p>
    </>
  );
}

function HistoryBody({
  trends, error
}: Pick<Props, 'trends' | 'error'>) {
  if (error !== null) return <p className="text-sm text-amber-800">{`History unavailable: ${error}`}</p>;
  if (trends === null || trends.trend_data.length === 0) {
    return <p className="text-sm text-gray-500">No analysis runs in this range yet.</p>;
  }
  return <TrendChart trends={trends} />;
}

/** The visibility score per period over the chosen range, with its definition in a tooltip. */
export function VisibilityHistory({
  trends, error, rangeDays, onRangeChange
}: Props) {
  return (
    <OverviewPanel
      title={`${CHARTED.label} history`}
      info={CHARTED.definition}
      actions={<RangeButtons rangeDays={rangeDays} onRangeChange={onRangeChange} />}
    >
      <HistoryBody trends={trends} error={error} />
    </OverviewPanel>
  );
}
