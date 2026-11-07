/**
 * Share of estimated search traffic against share of AI mentions: one group
 * per brand (you first, then each competitor), two bars on the 0–100 axis.
 * Traffic is DataForSEO's estimate, never measured clicks.
 */
import type {
  ChartConfiguration, TooltipItem
} from 'chart.js';
import { SEO_GEO_METRICS } from '../../../constants/seoGeoDefinitions';
import type { TrafficShareEntry } from '../../../types/api/seo';
import type { ChartTheme } from '../../ui/chartTheme';
import {
  AMBER, INDIGO
} from './chartPalette';
import {
  barChartConfiguration, percentChartOptions
} from './chartOptions';
import {
  listInWords, seriesLabels, type ChartSeries
} from './chartSeries';

export type TrafficSeriesKey = 'traffic_share' | 'share_of_voice';

/** The two bar series; none when no brand has an estimated traffic share. */
export function trafficShareSeries(entries: readonly TrafficShareEntry[]): Array<ChartSeries<TrafficSeriesKey>> {
  if (!entries.some((entry) => entry.traffic_share !== null)) return [];
  return [
    {
      key: 'traffic_share',
      label: SEO_GEO_METRICS.traffic_share.label,
      colour: INDIGO,
      points: entries.map((entry) => ({
        label: entry.name,
        value: entry.traffic_share,
      })),
    },
    {
      key: 'share_of_voice',
      label: SEO_GEO_METRICS.share_of_voice.label,
      colour: AMBER,
      points: entries.map((entry) => ({
        label: entry.name,
        value: entry.share_of_voice,
      })),
    },
  ];
}

function percent(value: number | null): string {
  return value === null ? 'unknown' : `${value.toFixed(1)}%`;
}

/** "Share of AI mentions: 25.0%". */
export function shareTooltipLabel(item: Pick<TooltipItem<'bar'>, 'dataset' | 'raw'>): string {
  return `${item.dataset.label ?? ''}: ${percent(typeof item.raw === 'number' ? item.raw : null)}`;
}

/** Grouped bars on the 0–100 axis, each tooltip naming the share in percent. */
export function buildTrafficShareChartConfiguration(
  series: ReadonlyArray<ChartSeries<TrafficSeriesKey>>,
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'bar'> {
  const options = percentChartOptions(theme);
  const tooltip = {
    ...options.plugins.tooltip,
    callbacks: { label: shareTooltipLabel },
  };
  return barChartConfiguration(series, isDark, {
    ...options,
    plugins: {
      ...options.plugins,
      tooltip,
    },
  });
}

/** "Share of estimated search traffic against share of AI mentions. You: 40.0% and 50.0%. Acme: 60.0% and 25.0%." */
export function describeTrafficShares(series: ReadonlyArray<ChartSeries<TrafficSeriesKey>>): string {
  if (series.length < 2) return '';
  const [traffic, voice] = series;
  const names = seriesLabels(series);
  const perBrand = names.map((name, index) => (
    `${name}: ${listInWords([percent(traffic.points[index]?.value ?? null), percent(voice.points[index]?.value ?? null)])}.`
  ));
  const against = `${voice.label.charAt(0).toLowerCase()}${voice.label.slice(1)}`;
  return [`${traffic.label} against ${against}.`, ...perBrand].join(' ');
}
