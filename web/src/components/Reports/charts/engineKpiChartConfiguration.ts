import type { ChartConfiguration } from 'chart.js';
import type { EngineKpis } from '../../../types/domain/visibility';
import { providerName } from '../../../constants/providers';
import type { ChartTheme } from '../../ui/chartTheme';
import {
  kpiLabelsInWords, kpiSeries, kpiValuesInWords, type ChartKpiId
} from './chartKpis';
import {
  barChartConfiguration, percentChartOptions
} from './chartOptions';
import {
  seriesLabels, type ChartSeries
} from './chartSeries';

/** The KPIs the engine chart compares unless told otherwise. */
export const DEFAULT_ENGINE_KPI_IDS: readonly ChartKpiId[] = ['mention_rate', 'visibility_score', 'citation_rate'];

/** One bar series per KPI of `ids`, one category per engine in the given order; none without an engine. */
export function engineKpiSeries(engines: readonly EngineKpis[], ids: readonly ChartKpiId[]): Array<ChartSeries<ChartKpiId>> {
  return kpiSeries(engines.map((engine) => ({
    label: providerName(engine.engine),
    kpis: engine.kpis,
  })), ids);
}

/** Grouped vertical bars: a group per engine, a bar per KPI in its fixed colour, on a 0–100 axis. */
export function buildEngineKpiChartConfiguration(
  series: ReadonlyArray<ChartSeries<ChartKpiId>>,
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'bar'> {
  return barChartConfiguration(series, isDark, percentChartOptions(theme));
}

/** "Mention rate and Visibility score per AI engine, on a 0–100 scale. OpenAI: Mention rate 70.0%, Visibility score 58.0." */
export function describeEngineKpis(series: ReadonlyArray<ChartSeries<ChartKpiId>>): string {
  const engines = seriesLabels(series);
  if (engines.length === 0) return '';
  const perEngine = engines.map((engine, index) => `${engine}: ${kpiValuesInWords(series, index)}.`);
  return [`${kpiLabelsInWords(series.map((bar) => bar.key))} per AI engine, on a 0–100 scale.`, ...perEngine].join(' ');
}
