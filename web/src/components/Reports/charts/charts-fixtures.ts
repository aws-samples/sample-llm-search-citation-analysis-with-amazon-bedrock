import { vi } from 'vitest';
import type {
  BrandLeaderboardRow, BrandTrends, EngineKpis, SourceRow
} from '../../../types/domain/visibility';
import type { SentimentSplit } from '../../../types/domain/groupKpiHistory';
import { getChartTheme } from '../../ui/chartTheme';
import { buildKpis } from '../BrandVisibilityReport/groupKpiHistory-fixtures';
import {
  buildBrandRow, buildBrandTrends, buildEngineKpis, buildEngines, buildSources
} from '../layout/reportPayload-fixtures';
import {
  kpiSeries, type ChartKpiId, type KpiCategory
} from './chartKpis';
import { EMERALD } from './chartPalette';
import type {
  ChartSeries, SeriesPoint
} from './chartSeries';
import {
  buildKpiTrendChartConfiguration, DEFAULT_KPI_TREND_IDS, kpiTrendSeries
} from './kpiTrendChartConfiguration';
import {
  buildEngineKpiChartConfiguration, DEFAULT_ENGINE_KPI_IDS, engineKpiSeries
} from './engineKpiChartConfiguration';
import {
  brandTrendSeries, buildBrandTrendChartConfiguration, DEFAULT_TRACKED_LABEL, type BrandTrendMetric
} from './brandTrendChartConfiguration';
import {
  buildShareOfVoiceChartConfiguration, shareOfVoiceSlices
} from './shareOfVoiceChartConfiguration';
import {
  buildSentimentSplitChartConfiguration, sentimentSeries, type SentimentRow
} from './sentimentSplitChartConfiguration';
import {
  buildTopSourcesChartConfiguration, topSources
} from './topSourcesChartConfiguration';

/** The light chart chrome. */
export const LIGHT_THEME = getChartTheme(false);

/** A 2D context stand-in: the mocked Chart never draws, so any object will do. */
export const CANVAS_CONTEXT = Object.create(null) as CanvasRenderingContext2D;

/** Makes every canvas hand out CANVAS_CONTEXT (jsdom has none), so `useThemedChart` constructs its chart. */
export function stubCanvasContext(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(CANVAS_CONTEXT);
}

/** Two periods with distinct values for every default trend KPI; the latest citation rate is unknown. */
export const KPI_POINTS: readonly KpiCategory[] = [
  {
    label: '2026-09-01',
    kpis: buildKpis({
      mention_rate: 70,
      share_of_voice: 20,
      visibility_score: 58.1,
      citation_rate: 29,
    }),
  },
  {
    label: '2026-09-08',
    kpis: buildKpis({ citation_rate: null }),
  },
];

/** Gemini and OpenAI (`buildEngines()`), then an engine the dashboard does not know. */
export const ENGINES = [
  ...buildEngines(),
  buildEngineKpis('mistral', {
    mention_rate: 10,
    visibility_score: 8.5,
    citation_rate: null,
  }),
];

/** A labelled split of `positive`, `neutral`, `mixed` and `negative` mentions. */
export function buildSentimentRow(label: string, [positive, neutral, mixed, negative]: readonly number[]): SentimentRow {
  const split: SentimentSplit = {
    positive,
    neutral,
    mixed,
    negative,
  };
  return {
    label,
    split,
  };
}

/** Nike with 12 labelled mentions (5 positive, 4 neutral, 2 mixed, 1 negative), then Puma with none. */
export const SENTIMENT_ROWS: readonly SentimentRow[] = [
  buildSentimentRow('Nike', [5, 4, 2, 1]),
  buildSentimentRow('Puma', [0, 0, 0, 0]),
];

/**
 * A leaderboard in visibility order whose share-of-voice order differs:
 * two first-party brands, three competitors, an "other" brand, and one
 * competitor without a share.
 */
export const LEADERBOARD: readonly BrandLeaderboardRow[] = [
  buildBrandRow('Nike', {
    classification: 'first_party',
    share_of_voice: 30,
  }),
  buildBrandRow('Adidas', { share_of_voice: 20 }),
  buildBrandRow('Jordan', {
    classification: 'first_party',
    share_of_voice: 12,
  }),
  buildBrandRow('Asics', { share_of_voice: 15 }),
  buildBrandRow('Decathlon', {
    classification: 'other',
    share_of_voice: 8,
  }),
  buildBrandRow('Puma', { share_of_voice: 10 }),
  buildBrandRow('Reebok', { share_of_voice: null }),
];


/** A series keyed and labelled `key`, emerald, with a point per `[label, value]`, unless overridden. */
export function buildSeries(
  key: string,
  points: ReadonlyArray<readonly [string, number | null]>,
  overrides: Partial<ChartSeries> = {},
): ChartSeries {
  return {
    key,
    label: key,
    colour: EMERALD,
    points: points.map(([label, value]): SeriesPoint => ({
      label,
      value,
    })),
    ...overrides,
  };
}

/** The KPI series of `KPI_POINTS` for `ids`. */
export function kpiPointSeries(ids: readonly ChartKpiId[]): Array<ChartSeries<ChartKpiId>> {
  return kpiSeries(KPI_POINTS, ids);
}

/** The KPI trend chart of `points`, in light mode unless `isDark`. */
export function kpiTrendChart(points: readonly KpiCategory[] = KPI_POINTS, isDark = false) {
  return buildKpiTrendChartConfiguration(kpiTrendSeries(points, DEFAULT_KPI_TREND_IDS), getChartTheme(isDark), isDark);
}

/** The engine chart of `engines` for `ids`, in light mode unless `isDark`. */
export function engineKpiChart(engines: readonly EngineKpis[] = ENGINES, ids = DEFAULT_ENGINE_KPI_IDS, isDark = false) {
  return buildEngineKpiChartConfiguration(engineKpiSeries(engines, ids), getChartTheme(isDark), isDark);
}

/** The brand trend chart of `trends` (`buildBrandTrends()`) for `metric`, in light mode unless `isDark`. */
export function brandTrendChart(metric: BrandTrendMetric = 'share_of_voice', trends: BrandTrends = buildBrandTrends(), isDark = false) {
  const series = brandTrendSeries(trends, {
    metric,
    trackedLabel: DEFAULT_TRACKED_LABEL,
  });
  return buildBrandTrendChartConfiguration(series, getChartTheme(isDark), isDark);
}

/** The share-of-voice doughnut of `brands` (LEADERBOARD) with `limit` slices, in light mode unless `isDark`. */
export function shareOfVoiceChart(brands: readonly BrandLeaderboardRow[] = LEADERBOARD, limit = 6, isDark = false) {
  return buildShareOfVoiceChartConfiguration(shareOfVoiceSlices(brands, limit), getChartTheme(isDark), isDark);
}

/** The sentiment chart of `rows` (SENTIMENT_ROWS), in light mode unless `isDark`. */
export function sentimentChart(rows: readonly SentimentRow[] = SENTIMENT_ROWS, isDark = false) {
  return buildSentimentSplitChartConfiguration(sentimentSeries(rows), getChartTheme(isDark), isDark);
}

/** The top-sources chart of `sources` (`buildSources()`) with `limit` bars, in light mode. */
export function topSourcesChart(sources: readonly SourceRow[] = buildSources(), limit = 10) {
  return buildTopSourcesChartConfiguration(topSources(sources, limit), LIGHT_THEME, false);
}

/** What every chart configuration shares, whatever its type. */
interface ConfigurationShape {
  readonly type: string;
  readonly options?: {
    readonly responsive?: boolean;
    readonly maintainAspectRatio?: boolean;
    readonly plugins?: {
      readonly legend?: unknown;
      readonly tooltip?: object;
    };
  };
}

/**
 * Every chart's light configuration of the fixture data, by builder name. Each row
 * carries the builder, so a spec builds the configuration inside its test, where a
 * mutant is active, not when this module loads.
 */
export const LIGHT_CONFIGURATIONS: ReadonlyArray<readonly [string, () => ConfigurationShape]> = [
  ['buildKpiTrendChartConfiguration', () => kpiTrendChart()],
  ['buildEngineKpiChartConfiguration', () => engineKpiChart()],
  ['buildBrandTrendChartConfiguration', () => brandTrendChart()],
  ['buildShareOfVoiceChartConfiguration', () => shareOfVoiceChart()],
  ['buildSentimentSplitChartConfiguration', () => sentimentChart()],
  ['buildTopSourcesChartConfiguration', () => topSourcesChart()],
];

/** The 0–100 value axis of every percentage chart, by builder name; built when a test calls it. */
export const PERCENT_AXES: ReadonlyArray<readonly [string, () => unknown]> = [
  ['buildKpiTrendChartConfiguration', () => kpiTrendChart().options?.scales?.y],
  ['buildEngineKpiChartConfiguration', () => engineKpiChart().options?.scales?.y],
  ['buildBrandTrendChartConfiguration', () => brandTrendChart().options?.scales?.y],
];
