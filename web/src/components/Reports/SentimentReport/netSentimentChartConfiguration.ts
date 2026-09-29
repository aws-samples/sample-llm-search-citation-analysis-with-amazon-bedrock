/**
 * The net sentiment over time: one line on a −100…+100 axis, which the
 * shared KPI trend chart (0–100) cannot draw.
 */
import type { ChartConfiguration } from 'chart.js';
import type { TrendDataPoint } from '../../../types';
import { formatKpi } from '../../../formatting/kpiFormatter';
import {
  themedAxis, type ChartTheme
} from '../../ui/chartTheme';
import { EMERALD } from '../charts/chartPalette';
import { chartOptions } from '../charts/chartOptions';
import {
  periodsInWords, seriesLabels, type ChartSeries
} from '../charts/chartSeries';
import { lineChartConfiguration } from '../charts/lineChartConfiguration';

/** The net sentiment's bounds: all mentions negative, all positive. */
export const NET_SENTIMENT_RANGE = {
  min: -100,
  max: 100,
} as const;

/** The net sentiment of each period, oldest first; no series without a period. */
export function netSentimentSeries(points: readonly TrendDataPoint[]): ChartSeries[] {
  if (points.length === 0) return [];
  return [{
    key: 'net_sentiment',
    label: 'Net sentiment',
    colour: EMERALD,
    emphasised: true,
    points: points.map((point) => ({
      label: point.period,
      value: point.kpis.net_sentiment,
    })),
  }];
}

/** The line of the shared trend charts, on a −100…+100 axis; unknown values are gaps. */
export function buildNetSentimentChartConfiguration(
  series: readonly ChartSeries[],
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'line'> {
  return {
    ...lineChartConfiguration(series, theme, isDark),
    options: chartOptions(theme, {
      x: themedAxis(theme),
      y: themedAxis(theme, NET_SENTIMENT_RANGE),
    }),
  };
}

/** "Net sentiment over 2 periods from A to B, from −100 (all negative) to +100 (all positive). Latest (B): +15.0." */
export function describeNetSentimentTrend(series: readonly ChartSeries[]): string {
  const labels = seriesLabels(series);
  if (labels.length === 0) return '';
  const latest = labels.length - 1;
  return `Net sentiment over ${periodsInWords(labels)}, from −100 (all negative) to +100 (all positive). `
    + `Latest (${labels[latest]}): ${formatKpi('net_sentiment', series[0].points[latest]?.value)}.`;
}
