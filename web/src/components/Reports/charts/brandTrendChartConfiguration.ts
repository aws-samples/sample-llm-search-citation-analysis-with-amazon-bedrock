import type {
  BrandTrendPoint, BrandTrends
} from '../../../types/domain/visibility';
import { KPI_DEFINITIONS } from '../../../constants/kpiDefinitions';
import { formatKpi } from '../../../formatting/kpiFormatter';
import {
  COMPETITOR_LINE_COLOURS, EMERALD, paletteColour
} from './chartPalette';
import {
  listInWords, trendCaption, type ChartSeries
} from './chartSeries';
import { lineChartConfiguration } from './lineChartConfiguration';

/** The brand KPIs a brand trend can draw, all on a 0–100 scale. */
export type BrandTrendMetric = 'share_of_voice' | 'mention_rate' | 'visibility_score';

/** What the tracked brand is called in the legend unless told otherwise. */
export const DEFAULT_TRACKED_LABEL = 'Your brand';

/** The key of the tracked brand's series (competitors are keyed by name). */
const TRACKED_SERIES_KEY = 'tracked';

export interface BrandTrendOptions {
  readonly metric: BrandTrendMetric;
  readonly trackedLabel: string;
}

function pointsOver(points: readonly BrandTrendPoint[], periods: readonly string[], metric: BrandTrendMetric) {
  const byPeriod = new Map(points.map((point) => [point.period, point[metric]]));
  return periods.map((period) => ({
    label: period,
    value: byPeriod.get(period) ?? null,
  }));
}

/**
 * The tracked brand (emphasised, emerald) then each competitor (amber,
 * orange, rose, violet, sky in turn) over every period of any of them,
 * oldest first; a brand without a point in a period has a gap there.
 */
export function brandTrendSeries(trends: BrandTrends, options: BrandTrendOptions): ChartSeries[] {
  const every = [...trends.tracked, ...trends.competitors.flatMap((competitor) => competitor.points)];
  const periods = [...new Set(every.map((point) => point.period))].sort((left, right) => left.localeCompare(right));
  if (periods.length === 0) return [];
  const tracked: ChartSeries = {
    key: TRACKED_SERIES_KEY,
    label: options.trackedLabel,
    colour: EMERALD,
    emphasised: true,
    points: pointsOver(trends.tracked, periods, options.metric),
  };
  return [tracked, ...trends.competitors.map((competitor, index) => ({
    key: competitor.name,
    label: competitor.name,
    colour: paletteColour(COMPETITOR_LINE_COLOURS, index),
    points: pointsOver(competitor.points, periods, options.metric),
  }))];
}

/** A line per brand on a 0–100 axis, the tracked brand thicker; unknown values are gaps. */
export const buildBrandTrendChartConfiguration = lineChartConfiguration;

/** "Share of voice of Your brand, Adidas and Puma over 2 periods from A to B, on a 0–100 scale. Latest (B): Your brand 25.0%, …." */
export function describeBrandTrend(series: readonly ChartSeries[], metric: BrandTrendMetric): string {
  const names = series.map((line) => line.label);
  return trendCaption(series, (periods, latest) => {
    const values = series.map((line) => `${line.label} ${formatKpi(metric, line.points[latest.index].value)}`);
    return `${KPI_DEFINITIONS[metric].label} of ${listInWords(names)} over ${periods}, on a 0–100 scale. `
      + `Latest (${latest.label}): ${values.join(', ')}.`;
  });
}
