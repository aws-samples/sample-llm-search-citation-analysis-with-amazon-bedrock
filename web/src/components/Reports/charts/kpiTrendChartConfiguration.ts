import {
  kpiLabelsInWords, kpiSeries, kpiValuesInWords, type ChartKpiId, type KpiCategory
} from './chartKpis';
import {
  trendCaption, type ChartSeries
} from './chartSeries';
import { lineChartConfiguration } from './lineChartConfiguration';

/** The KPIs a trend chart draws unless told otherwise. */
export const DEFAULT_KPI_TREND_IDS: readonly ChartKpiId[] = ['mention_rate', 'share_of_voice', 'visibility_score', 'citation_rate'];

/** One line per KPI of `ids` over `points`, oldest first; none without a point. */
export const kpiTrendSeries: (points: readonly KpiCategory[], ids: readonly ChartKpiId[]) => Array<ChartSeries<ChartKpiId>> = kpiSeries;

/** A line per KPI in its fixed colour on one 0–100 axis; unknown values are gaps. */
export const buildKpiTrendChartConfiguration = lineChartConfiguration;

/** "Mention rate and Visibility score over 2 periods from A to B, on a 0–100 scale. Latest (B): Mention rate 60.0%, Visibility score 52.4." */
export function describeKpiTrend(series: ReadonlyArray<ChartSeries<ChartKpiId>>): string {
  return trendCaption(series, (periods, latest) => `${kpiLabelsInWords(series.map((line) => line.key))} over ${periods}, on a 0–100 scale. `
    + `Latest (${latest.label}): ${kpiValuesInWords(series, latest.index)}.`);
}
