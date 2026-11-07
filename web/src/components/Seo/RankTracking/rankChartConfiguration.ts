/**
 * Chart.js configurations of rank tracking.
 *
 * - Keyword history: one line per device over the check dates, the y axis reversed (#1 on top) from 1 to the
 *   tracker's depth. A miss is plotted at the depth, so a drop reads as a dip; an unchecked date is a gap.
 * - Trend: per finished run, the stacked count of keywords in the top 3, 4-10, 11-20, not ranking and not checked.
 */
import type {
  ChartConfiguration, TooltipItem
} from 'chart.js';
import type {
  RankDevice, RankHistoryPoint, RankTrendPoint
} from '../../../types/api/seoRankTracking';
import {
  themedAxis, type ChartTheme
} from '../../ui/chartTheme';
import {
  AMBER, EMERALD, GRAY, INDIGO, OTHER_BRANDS_GRAY, resolveColour, type ThemedColour
} from '../../Reports/charts/chartPalette';
import { chartOptions } from '../../Reports/charts/chartOptions';

const DEVICE_COLOURS: Readonly<Record<RankDevice, ThemedColour>> = {
  desktop: INDIGO,
  mobile: EMERALD,
};

export const TREND_BUCKETS = [
  {
    key: 'top3',
    label: 'Top 3',
    colour: EMERALD 
  },
  {
    key: 'top4_10',
    label: '4–10',
    colour: INDIGO 
  },
  {
    key: 'top11_20',
    label: '11–20',
    colour: AMBER 
  },
  {
    key: 'not_ranking',
    label: 'Not in top 20',
    colour: GRAY 
  },
  {
    key: 'not_checked',
    label: 'Not checked',
    colour: OTHER_BRANDS_GRAY 
  },
] as const;

export interface HistorySeries {
  readonly depth: number;
  readonly points: readonly RankHistoryPoint[];
}

/** The check dates (YYYY-MM-DD) in order. */
function historyLabels(points: readonly RankHistoryPoint[]): string[] {
  return [...new Set(points.map((point) => point.checked_at.slice(0, 10)))].sort((left, right) => left.localeCompare(right));
}

/** Each date's plotted position for one device: the best of that day, a miss at `depth`, `null` when not checked. */
export function deviceValues(series: HistorySeries, device: RankDevice, labels: readonly string[]): (number | null)[] {
  return labels.map((label) => {
    const day = series.points.filter((point) => point.device === device && point.checked_at.startsWith(label));
    if (day.length === 0) return null;
    const found = day.flatMap((point) => (point.position === null ? [] : [point.position]));
    return found.length > 0 ? Math.min(...found) : series.depth;
  });
}

function positionLabel(depth: number) {
  return (item: Pick<TooltipItem<'line'>, 'parsed' | 'dataset'>): string => {
    const value = item.parsed.y;
    const position = value === null || value >= depth ? 'not in top '.concat(String(depth)) : '#'.concat(String(value));
    return `${item.dataset.label ?? ''}: ${position}`;
  };
}

export function buildHistoryChartConfiguration(
  series: HistorySeries[], theme: ChartTheme, isDark: boolean,
): ChartConfiguration<'line'> {
  const [only] = series;
  const labels = historyLabels(only.points);
  const devices = (['desktop', 'mobile'] as const).filter((device) => only.points.some((point) => point.device === device));
  const options = chartOptions(theme, {
    x: themedAxis(theme),
    y: themedAxis(theme, {
      reverse: true,
      min: 1,
      max: only.depth,
      ticks: { stepSize: Math.max(1, Math.round(only.depth / 10)) } 
    }),
  });
  const { plugins } = options;
  return {
    type: 'line',
    data: {
      labels,
      datasets: devices.map((device) => ({
        label: device === 'desktop' ? 'Desktop' : 'Mobile',
        data: deviceValues(only, device, labels),
        borderColor: resolveColour(DEVICE_COLOURS[device], isDark),
        backgroundColor: resolveColour(DEVICE_COLOURS[device], isDark),
        spanGaps: false,
        tension: 0.2,
      })),
    },
    options: {
      ...options,
      plugins: {
        legend: plugins.legend,
        tooltip: {
          ...plugins.tooltip,
          callbacks: { label: positionLabel(only.depth) },
        },
      },
    },
  };
}

/** Bars stacked on both axes; whole keyword counts from zero on y. */
function stackedCountScales(theme: ChartTheme) {
  const stacked = { stacked: true };
  return {
    y: themedAxis(theme, {
      ...stacked,
      beginAtZero: true,
      ticks: { precision: 0 },
    }),
    x: themedAxis(theme, stacked),
  };
}

export function buildTrendChartConfiguration(
  points: RankTrendPoint[], theme: ChartTheme, isDark: boolean,
): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: {
      labels: points.map((point) => point.started_at.slice(0, 10)),
      datasets: TREND_BUCKETS.map((bucket) => ({
        label: bucket.label,
        data: points.map((point) => point[bucket.key]),
        backgroundColor: resolveColour(bucket.colour, isDark),
      })),
    },
    options: chartOptions(theme, stackedCountScales(theme)),
  };
}

/** The trend in words, for screen readers: the newest run's buckets. */
export function describeTrend(points: readonly RankTrendPoint[]): string {
  if (points.length === 0) return 'No finished rank check yet.';
  const latest = points[points.length - 1];
  const parts = TREND_BUCKETS.map((bucket) => `${bucket.label} ${latest[bucket.key]}`);
  return `Latest check ${latest.started_at.slice(0, 10)}: ${parts.join(', ')}.`;
}
