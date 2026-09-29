import type {
  BrandLeaderboardRow, HistoricalTrendsResponse, KeywordTrend, TrendDataPoint, TrendDirection, VisibilityResponse
} from '../../../types';
import type {
  ReportsOverviewMover, ReportsOverviewResponse
} from '../../../api/reports';
import {
  buildDeltas, buildKpis, buildTrends, GROUP_DELTAS, GROUP_TRENDS, RUN_1, RUN_2
} from '../BrandVisibilityReport/groupKpiHistory-fixtures';

/**
 * Payloads of `GET /visibility`, `GET /trends` and `GET /reports/overview`
 * for the report specs. KPIs are `buildKpis()` and changes `GROUP_DELTAS` /
 * `GROUP_TRENDS` unless overridden, so every figure is distinct.
 */

/** The latest period of every keyword trend, and the one before it. */
export const LATEST_PERIOD = '2026-09-08';
export const PREVIOUS_PERIOD = '2026-09-01';

type TrendChange = NonNullable<HistoricalTrendsResponse['change']>;

/** The latest period against the previous one over `keywords_compared` keywords (3 unless overridden). */
export function buildPeriodChange(overrides: Partial<TrendChange> = {}): TrendChange {
  return {
    keywords_compared: 3,
    deltas: GROUP_DELTAS,
    trends: GROUP_TRENDS,
    ...overrides,
  };
}

/** One day of a trend series: two runs of every keyword, with the KPIs of `buildKpis()` unless overridden. */
export function buildTrendPoint(period: string, overrides: Partial<TrendDataPoint> = {}): TrendDataPoint {
  return {
    period,
    runs: 2,
    keywords_with_data: 3,
    kpis: buildKpis(),
    ...overrides,
  };
}

/** `count` days labelled `d-00`, `d-01`, … with a visibility score rising from 40, so sampling can be checked by label. */
export function buildTrendPoints(count: number): TrendDataPoint[] {
  return Array.from({ length: count }, (_, index) => buildTrendPoint(
    `d-${index.toString().padStart(2, '0')}`,
    { kpis: buildKpis({ visibility_score: 40 + index }) },
  ));
}

/** A keyword's latest period with the KPIs of `buildKpis()` and no earlier period, unless overridden. */
export function buildKeywordTrend(keyword: string, overrides: Partial<KeywordTrend> = {}): KeywordTrend {
  return {
    keyword,
    period: LATEST_PERIOD,
    kpis: buildKpis(),
    change: null,
    ...overrides,
  };
}

/** A keyword whose visibility score (`score`) moved by `delta` points since PREVIOUS_PERIOD, judged `trend`. */
export function movingKeyword(keyword: string, delta: number, trend: TrendDirection, score = 50): KeywordTrend {
  return buildKeywordTrend(keyword, {
    kpis: buildKpis({ visibility_score: score }),
    change: {
      previous_period: PREVIOUS_PERIOD,
      deltas: buildDeltas({ visibility_score: delta }),
      trends: buildTrends({ visibility_score: trend }),
    },
  });
}

/** What `/trends` and `/reports/overview` share about the window of every fixture. */
const WINDOW = {
  period_type: 'day',
  days_analyzed: 30,
  keywords_analyzed: 4,
  keywords_with_data: 3,
  citations_configured: true,
} as const;

/** `/trends` for every keyword: `buildKpis()` as the latest standing and `buildPeriodChange()` as its move, unless overridden. */
export function buildTrendView(overrides: Partial<HistoricalTrendsResponse> = {}): HistoricalTrendsResponse {
  return {
    ...WINDOW,
    scope: {
      kind: 'all',
      label: 'All keywords',
      keyword_count: 4,
    },
    since: RUN_1,
    keywords_truncated: false,
    trend_data: [buildTrendPoint(PREVIOUS_PERIOD), buildTrendPoint(LATEST_PERIOD)],
    latest: buildKpis(),
    change: buildPeriodChange(),
    keyword_trends: [],
    overall: {
      improving_count: 1,
      declining_count: 1,
      stable_count: 1,
    },
    ...overrides,
  };
}

/** `buildTrendView()` over exactly `rows`, in the order given (the API's: best visibility score first). */
export function trendViewOf(rows: KeywordTrend[]): HistoricalTrendsResponse {
  return buildTrendView({ keyword_trends: rows });
}

/** A brand of a leaderboard: a competitor named in 12 answers unless overridden. */
export function buildBrandRow(name: string, overrides: Partial<BrandLeaderboardRow> = {}): BrandLeaderboardRow {
  return {
    name,
    classification: 'competitor',
    mentions: 12,
    mention_rate: 60,
    share_of_voice: 25,
    average_position: 1.8,
    best_position: 1,
    visibility_score: 52.4,
    engines: ['gemini', 'openai'],
    keywords: 1,
    net_sentiment: 15,
    ...overrides,
  };
}

/** `/visibility` of the keyword "best running shoes" at RUN_2: `buildKpis()` and a two-brand leaderboard, unless overridden. */
export function buildVisibility(overrides: Partial<VisibilityResponse> = {}): VisibilityResponse {
  return {
    scope: {
      kind: 'keyword',
      label: 'best running shoes',
      keyword_count: 1,
    },
    timestamp: RUN_2,
    keywords_truncated: false,
    citations_configured: true,
    keywords_analyzed: 1,
    keywords_with_data: 1,
    kpis: buildKpis(),
    change: null,
    brands: [
      buildBrandRow('Nike', { classification: 'first_party' }),
      buildBrandRow('Adidas', { visibility_score: 30 }),
    ],
    keywords: [{
      keyword: 'best running shoes',
      timestamp: RUN_2,
      has_data: true,
      kpis: buildKpis(),
    }],
    ...overrides,
  };
}

/** A keyword of the overview's movers: its visibility score now and its change in points. */
export function buildMover(keyword: string, change: number, score = 50): ReportsOverviewMover {
  return {
    keyword,
    visibility_score: score,
    change,
  };
}

/** `/reports/overview` for every keyword: the standing of `buildTrendView()`, no movers and no recommendations, unless overridden. */
export function buildOverview(overrides: Partial<ReportsOverviewResponse> = {}): ReportsOverviewResponse {
  const trends = buildTrendView();
  return {
    ...WINDOW,
    generated_at: RUN_2,
    scope: trends.scope,
    kpis: trends.latest,
    change: trends.change,
    summary: trends.overall,
    top_improving: [],
    top_declining: [],
    top_recommendations: [],
    ...overrides,
  };
}
