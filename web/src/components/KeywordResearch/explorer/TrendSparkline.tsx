import type { MonthlySearch } from '../../../types/api/seo';
import {
  UNKNOWN_VALUE, trendSeries
} from './keywordExplorerFormat';

const WIDTH = 80;
const HEIGHT = 24;

function points(series: readonly number[]): string {
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min || 1;
  const step = series.length > 1 ? WIDTH / (series.length - 1) : 0;
  return series
    .map((value, index) => `${(index * step).toFixed(1)},${(HEIGHT - 2 - ((value - min) / span) * (HEIGHT - 4)).toFixed(1)}`)
    .join(' ');
}

/**
 * Twelve-month search volume as a small inline line (a Chart.js canvas per
 * row would be hundreds of charts); the stroke follows the text colour, so it
 * themes with the table.
 */
export function TrendSparkline({
  trend, keyword
}: {
  readonly trend: readonly MonthlySearch[];
  readonly keyword: string 
}) {
  const series = trendSeries(trend);
  if (series.length < 2) return <span className="text-gray-500">{UNKNOWN_VALUE}</span>;
  return (
    <span className="inline-flex">
      <svg aria-hidden="true" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="text-gray-500">
        <polyline points={points(series)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
      <span className="sr-only">
        {`Monthly search volume of ${keyword}, last ${series.length} months: ${series.join(', ')}`}
      </span>
    </span>
  );
}
