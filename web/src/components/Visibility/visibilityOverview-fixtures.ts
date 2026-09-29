import type {
  BrandLeaderboardRow, HistoricalTrendsResponse, KeywordVisibilityRow, ReportScopeInfo, ScopeChange, TrendDataPoint, VisibilityResponse
} from '../../types';
import {
  GROUP_DELTAS, GROUP_TRENDS, RUN_2, buildKpis
} from '../Reports/BrandVisibilityReport/groupKpiHistory-fixtures';

/** The latest runs against the previous ones, over the one keyword analysed twice. */
export const RUN_CHANGE: ScopeChange = {
  keywords_compared: 1,
  deltas: GROUP_DELTAS,
  trends: GROUP_TRENDS,
};

/** The "Hotel Sol" group with two keywords, as the endpoints echo it back. */
export const GROUP_SCOPE_INFO: ReportScopeInfo = {
  kind: 'group',
  label: 'Hotel Sol',
  keyword_count: 2,
};

/** The single keyword "hotel sol spa", as the endpoints echo it back. */
export const KEYWORD_SCOPE_INFO: ReportScopeInfo = {
  kind: 'keyword',
  label: 'hotel sol spa',
  keyword_count: 1,
};

/** "hotel sol spa" at RUN_2 with every KPI of `buildKpis()` unless overridden. */
export function buildKeywordRow(overrides: Partial<KeywordVisibilityRow> = {}): KeywordVisibilityRow {
  return {
    keyword: 'hotel sol spa',
    timestamp: RUN_2,
    has_data: true,
    kpis: buildKpis(),
    ...overrides,
  };
}

/** "hotel sol beach": in the scope, never analysed. */
export const KEYWORD_WITHOUT_DATA: KeywordVisibilityRow = {
  keyword: 'hotel sol beach',
  timestamp: null,
  has_data: false,
  kpis: null,
};

/** The tracked brand "Hotel Sol"; every figure is distinct from the competitor's. */
export function buildBrandRow(overrides: Partial<BrandLeaderboardRow> = {}): BrandLeaderboardRow {
  return {
    name: 'Hotel Sol',
    classification: 'first_party',
    mentions: 12,
    mention_rate: 60,
    share_of_voice: 25,
    average_position: 1.8,
    best_position: 1,
    visibility_score: 52.4,
    engines: ['gemini', 'openai'],
    keywords: 2,
    net_sentiment: 15,
    ...overrides,
  };
}

/** The competitor "Hotel Luna": fewer mentions, a worse position, no labelled sentiment. */
export const COMPETITOR_ROW: BrandLeaderboardRow = buildBrandRow({
  name: 'Hotel Luna',
  classification: 'competitor',
  mentions: 8,
  mention_rate: 40,
  share_of_voice: 16.7,
  average_position: 2.5,
  best_position: 2,
  visibility_score: 33.1,
  engines: ['perplexity'],
  keywords: 1,
  net_sentiment: null,
});

/**
 * `/visibility` of the "Hotel Sol" group: one keyword analysed at RUN_2, one
 * never analysed, and the tracked brand ahead of one competitor.
 */
export function buildVisibility(overrides: Partial<VisibilityResponse> = {}): VisibilityResponse {
  return {
    scope: GROUP_SCOPE_INFO,
    timestamp: RUN_2,
    keywords_truncated: false,
    citations_configured: true,
    keywords_analyzed: 2,
    keywords_with_data: 1,
    kpis: buildKpis(),
    change: RUN_CHANGE,
    brands: [buildBrandRow(), COMPETITOR_ROW],
    keywords: [buildKeywordRow(), KEYWORD_WITHOUT_DATA],
    ...overrides,
  };
}

/** One day of the trend: the RUN_2 KPIs unless overridden. */
export function buildTrendPoint(overrides: Partial<TrendDataPoint> = {}): TrendDataPoint {
  return {
    period: '2026-09-08',
    runs: 1,
    keywords_with_data: 1,
    kpis: buildKpis(),
    ...overrides,
  };
}

/** RUN_1's day: a visibility score 8.2 points above RUN_2's (`GROUP_DELTAS`). */
export const FIRST_TREND_POINT: TrendDataPoint = buildTrendPoint({
  period: '2026-09-01',
  runs: 2,
  keywords_with_data: 2,
  kpis: buildKpis({ visibility_score: 60.6 }),
});

/**
 * `/trends` of the "Hotel Sol" group over 30 days: RUN_1's day then RUN_2's,
 * compared over one keyword with `GROUP_DELTAS` / `GROUP_TRENDS`.
 */
export function buildTrendsResponse(overrides: Partial<HistoricalTrendsResponse> = {}): HistoricalTrendsResponse {
  return {
    scope: GROUP_SCOPE_INFO,
    period_type: 'day',
    days_analyzed: 30,
    since: '2026-08-16',
    keywords_analyzed: 2,
    keywords_with_data: 1,
    keywords_truncated: false,
    citations_configured: true,
    trend_data: [FIRST_TREND_POINT, buildTrendPoint()],
    latest: buildKpis(),
    change: RUN_CHANGE,
    keyword_trends: [{
      keyword: 'hotel sol spa',
      period: '2026-09-08',
      kpis: buildKpis(),
      change: null,
    }],
    overall: {
      improving_count: 0,
      declining_count: 0,
      stable_count: 1,
    },
    ...overrides,
  };
}


/** The export's KPI cells of `buildKpis()`, headed "<Label> (<unit>)". */
export const BUILT_KPI_CELLS: Readonly<Record<string, number>> = {
  Answers: 20,
  Mentions: 12,
  'Mention rate (%)': 60,
  'Share of voice (%)': 25,
  'Average position': 1.8,
  'Top-1 share (%)': 40,
  'Top-3 share (%)': 55,
  'Visibility score (0-100)': 52.4,
  Citations: 6,
  'Citation rate (%)': 30,
  'Citation share (%)': 12.5,
  'Net sentiment (-100 to +100)': 15,
  'Engine coverage (%)': 75,
  'Keyword coverage (%)': 80,
};

/** The export's KPI cells of a keyword without data: every one empty. */
export const EMPTY_KPI_CELLS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.keys(BUILT_KPI_CELLS).map((header) => [header, ''])
);


/** Two days: a visibility score of exactly 50, then a day whose answers could not be scored. */
export const TRENDS_WITH_GAP: HistoricalTrendsResponse = buildTrendsResponse({
  trend_data: [
    buildTrendPoint({
      period: '2026-09-01',
      runs: 2,
      keywords_with_data: 2,
      kpis: buildKpis({ visibility_score: 50 }),
    }),
    buildTrendPoint({ kpis: buildKpis({ visibility_score: null }) }),
  ],
});
