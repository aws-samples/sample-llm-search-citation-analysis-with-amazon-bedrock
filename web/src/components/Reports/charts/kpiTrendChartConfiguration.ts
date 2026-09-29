import type { ChartConfiguration } from 'chart.js';
import type { ChartTheme } from '../../ui/chartTheme';
import {
  kpiLabelsInWords, kpiSeries, kpiValuesInWords, type ChartKpiId, type KpiCategory
} from './chartKpis';
import {
  periodsInWords, seriesLabels, type ChartSeries
} from './chartSeries';
import { lineChartConfiguration } from './lineChartConfiguration';

/** The KPIs a trend chart draws unless told otherwise. */
export const DEFAULT_KPI_TREND_IDS: readonly ChartKpiId[] = ['mention_rate', 'share_of_voice', 'visibility_score', 'citation_rate'];

/** One line per KPI of `ids` over `points`, oldest first; none without a point. */
export function kpiTrendSeries(points: readonly KpiCategory[], ids: readonly ChartKpiId[]): Array<ChartSeries<ChartKpiId>> {
  return kpiSeries(points, ids);
}

/** A line per KPI in its fixed colour on one 0–100 axis; unknown values are gaps. */
export function buildKpiTrendChartConfiguration(
  series: ReadonlyArray<ChartSeries<ChartKpiId>>,
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'line'> {
  return lineChartConfiguration(series, theme, isDark);
}

/** "Mention rate and Visibility score over 2 periods from A to B, on a 0–100 scale. Latest (B): Mention rate 60.0%, Visibility score 52.4." */
export function describeKpiTrend(series: ReadonlyArray<ChartSeries<ChartKpiId>>): string {
  const labels = seriesLabels(series);
  if (labels.length === 0) return '';
  const latest = labels.length - 1;
  return `${kpiLabelsInWords(series.map((line) => line.key))} over ${periodsInWords(labels)}, on a 0–100 scale. `
    + `Latest (${labels[latest]}): ${kpiValuesInWords(series, latest)}.`;
}
