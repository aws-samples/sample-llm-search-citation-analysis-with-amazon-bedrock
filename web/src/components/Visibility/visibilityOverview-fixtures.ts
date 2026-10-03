import type {
  BrandLeaderboardRow, BrandTrends, EngineKpis, HistoricalTrendsResponse, KeywordVisibilityRow, ReportScopeInfo, ScopeChange, SourceRow,
  TrendDataPoint, VisibilityResponse
} from '../../types';
import {
  GROUP_DELTAS, GROUP_TRENDS, RUN_2, buildKpis
} from '../Reports/BrandVisibilityReport/groupKpiHistory-fixtures';
import {
  buildBrandRow as buildLeaderboardRow, buildBrandTrendPoint, buildEngineKpis, buildSourceRow, buildVisibility as buildKeywordVisibility
} from '../Reports/layout/reportPayload-fixtures';

/** The latest runs against the previous ones, over the one keyword analysed twice. */
const RUN_CHANGE: ScopeChange = {
  keywords_compared: 1,
  deltas: GROUP_DELTAS,
  trends: GROUP_TRENDS,
};

/** The "Hotel Sol" group with two keywords, as the endpoints echo it back. */
const GROUP_SCOPE_INFO: ReportScopeInfo = {
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
  return buildLeaderboardRow('Hotel Sol', {
    classification: 'first_party',
    keywords: 2,
    ...overrides,
  });
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

/** OpenAI and Perplexity, ten answers each, in name order; together they make the 20 answers and 12 mentions of `buildKpis()`. */
export function buildGroupEngines(): EngineKpis[] {
  return [
    buildEngineKpis('openai', {
      answers: 10,
      mentions: 7,
      mention_rate: 70,
      visibility_score: 58,
      citation_rate: 40,
    }),
    buildEngineKpis('perplexity', {
      answers: 10,
      mentions: 5,
      mention_rate: 50,
      visibility_score: 46.8,
      citation_rate: 20,
    }),
  ];
}

/** The group's cited domains, most cited first: a booking site, the owned hotelsol.com (30% citation rate) and a review site. */
export function buildGroupSources(): SourceRow[] {
  return [
    buildSourceRow('booking.com', {
      citations: 8,
      citation_rate: 40,
      citation_share: 47.1,
    }),
    buildSourceRow('hotelsol.com', {
      owned: true,
      citations: 6,
      citation_rate: 30,
      citation_share: 35.3,
      engines: ['openai', 'perplexity'],
    }),
    buildSourceRow('tripadvisor.com', {
      citations: 3,
      citation_share: 17.6,
      citation_rate: 15,
      keywords: 1,
      engines: ['perplexity'],
    }),
  ];
}

/**
 * "Hotel Sol" on the two trend days (RUN_1's visibility score 60.6, then
 * RUN_2's KPIs) against Hotel Luna (latest point as COMPETITOR_ROW) and
 * Hotel Mar, which no answer named on the first day.
 */
function buildGroupBrandTrends(overrides: Partial<BrandTrends> = {}): BrandTrends {
  return {
    tracked: [buildBrandTrendPoint('2026-09-01', { visibility_score: 60.6 }), buildBrandTrendPoint('2026-09-08')],
    competitors: [
      {
        name: 'Hotel Luna',
        points: [
          buildBrandTrendPoint('2026-09-01', {
            mention_rate: 45,
            share_of_voice: 18,
            visibility_score: 36,
            average_position: 2.2,
          }),
          buildBrandTrendPoint('2026-09-08', {
            mention_rate: 40,
            share_of_voice: 16.7,
            visibility_score: 33.1,
            average_position: 2.5,
          }),
        ],
      },
      {
        name: 'Hotel Mar',
        points: [
          buildBrandTrendPoint('2026-09-01', {
            mention_rate: 0,
            share_of_voice: 0,
            visibility_score: 0,
            average_position: null,
          }),
          buildBrandTrendPoint('2026-09-08', {
            mention_rate: 15,
            share_of_voice: 6.3,
            visibility_score: 11.9,
            average_position: 3.5,
          }),
        ],
      },
    ],
    ...overrides,
  };
}

/**
 * `/visibility` of the "Hotel Sol" group: one keyword analysed at RUN_2, one
 * never analysed, and the tracked brand ahead of one competitor.
 */
export function buildVisibility(overrides: Partial<VisibilityResponse> = {}): VisibilityResponse {
  return buildKeywordVisibility({
    scope: GROUP_SCOPE_INFO,
    keywords_analyzed: 2,
    change: RUN_CHANGE,
    brands: [buildBrandRow(), COMPETITOR_ROW],
    engines: buildGroupEngines(),
    sources: buildGroupSources(),
    keywords: [buildKeywordRow(), KEYWORD_WITHOUT_DATA],
    ...overrides,
  });
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

/** `count` consecutive September days from the 1st, each with the RUN_2 KPIs. */
export function buildDailyTrendPoints(count: number): TrendDataPoint[] {
  return Array.from({ length: count }, (_unused, index) => buildTrendPoint({ period: `2026-09-${String(index + 1).padStart(2, '0')}` }));
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
    latest_brands: [buildBrandRow(), COMPETITOR_ROW],
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
    brand_trends: buildGroupBrandTrends(),
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


/** The words of the KPI history chart of `buildTrendsResponse()`: RUN_1's day, then the KPIs of RUN_2 as the latest. */
export const GROUP_TREND_CAPTION = 'Mention rate, Share of voice, Visibility score and Citation rate over 2 periods from 2026-09-01 to 2026-09-08, '
  + 'on a 0–100 scale. Latest (2026-09-08): Mention rate 60.0%, Share of voice 25.0%, Visibility score 52.4, Citation rate 30.0%.';

/** The words of the share-of-voice donut of `buildVisibility().brands`. */
export const GROUP_SHARE_OF_VOICE_CAPTION = 'Share of voice: Hotel Sol 25.0% and Hotel Luna 16.7%.';

/** The words of the engine chart of `buildGroupEngines()`. */
export const GROUP_ENGINES_CAPTION = 'Mention rate, Visibility score and Citation rate per AI engine, on a 0–100 scale. '
  + 'OpenAI: Mention rate 70.0%, Visibility score 58.0, Citation rate 40.0%. '
  + 'Perplexity: Mention rate 50.0%, Visibility score 46.8, Citation rate 20.0%.';

/** The words of the top-domains chart of `buildGroupSources()`. */
export const GROUP_SOURCES_CAPTION = 'Answers citing each of the 3 most cited domains: booking.com 8, hotelsol.com 6 (yours) and tripadvisor.com 3.';

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
