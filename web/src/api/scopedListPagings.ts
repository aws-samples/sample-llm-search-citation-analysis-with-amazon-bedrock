/**
 * Where each 2.45.0 scoped route keeps its paged list (`test-fixtures/scope-snapshots/*.json`
 * `paging`), with the guard of one list item. The views page these lists with `useScopedList`;
 * Export all writes them whole on the server.
 */
import { isRecord } from '../types/domain/keywordDecoders';
import type {
  BrandLeaderboardRow, CitationGap, CitationGapsResponse, KeywordTrend, KeywordVisibilityRow, Recommendation, SourceRow
} from '../types';
import type {
  CompetitorExclusiveSource, CompetitorOutrankedKeyword
} from './reports';
import type { ListPaging } from './scopedListPages';

/** `/visibility` keyword rows; next pages from `view=keywords`. */
export const VISIBILITY_KEYWORD_PAGING: ListPaging = {
  list: 'keywords',
  token: 'keywords_next_token',
  total: 'keywords_total',
  view: 'keywords',
};

/** `/visibility` brand leaderboard (2.45.0 wave 5); next pages from `view=brands`. */
export const VISIBILITY_BRANDS_PAGING: ListPaging = {
  list: 'brands',
  token: 'brands_next_token',
  total: 'brands_total',
  view: 'brands',
};

/** `/visibility` cited domains (2.45.0 wave 5); next pages from `view=sources`. */
export const VISIBILITY_SOURCES_PAGING: ListPaging = {
  list: 'sources',
  token: 'sources_next_token',
  total: 'sources_total',
  view: 'sources',
};

/** `/trends` keyword moves; next pages from `view=keyword_trends`. */
export const KEYWORD_TRENDS_PAGING: ListPaging = {
  list: 'keyword_trends',
  token: 'keyword_trends_next_token',
  total: 'keyword_trends_total',
  view: 'keyword_trends',
};

/** `/trends` latest-period brand leaderboard (2.45.0 wave 5); next pages from `view=latest_brands`. */
export const TREND_BRANDS_PAGING: ListPaging = {
  list: 'latest_brands',
  token: 'latest_brands_next_token',
  total: 'latest_brands_total',
  view: 'latest_brands',
};

/** `/reports/group-kpis` summary keywords; next pages from `view=keywords`. */
export const GROUP_KPI_KEYWORDS_PAGING: ListPaging = {
  list: 'keywords',
  token: 'keywords_next_token',
  total: 'keywords_total',
  view: 'keywords',
};

/** `/citation-gaps` keyword summaries; the next page is the same GET with `next_token`. */
export const GAP_SUMMARIES_PAGING: ListPaging = {
  list: 'keyword_summaries',
  token: 'keyword_summaries_next_token',
  total: 'keyword_summaries_total',
  view: null,
};

/**
 * `/citation-gaps` gap cards (2.45.0 wave 5): every gap of the scope over `view=gaps`; the first
 * page is the answer's `gaps` (one keyword) or `top_gaps` (a scope), read as `gaps`.
 */
export const GAPS_PAGING: ListPaging = {
  list: 'gaps',
  token: 'gaps_next_token',
  total: 'gaps_total',
  view: 'gaps',
};

/** `/recommendations`, itself a list. */
export const RECOMMENDATIONS_PAGING: ListPaging = {
  list: 'recommendations',
  token: 'next_token',
  total: 'total',
  view: null,
};

/** `/reports/competitor` outranked keywords, inside `rollup`. */
export const OUTRANKED_KEYWORDS_PAGING: ListPaging = {
  list: 'rollup.outranked_keywords',
  token: 'rollup.outranked_keywords_next_token',
  total: 'rollup.outranked_keywords_total',
  view: null,
};

/**
 * `/reports/competitor` outreach targets (2.45.0 wave 5): every exclusive source of the
 * competitor, best lift first, inside `rollup`; next pages from `view=outreach`.
 */
export const OUTREACH_TARGETS_PAGING: ListPaging = {
  list: 'rollup.outreach_targets',
  token: 'rollup.outreach_targets_next_token',
  total: 'rollup.outreach_targets_total',
  view: 'outreach',
};

const isNullableString = (value: unknown): boolean => value === null || typeof value === 'string';

export function isKeywordVisibilityRow(value: unknown): value is KeywordVisibilityRow {
  return isRecord(value)
    && typeof value.keyword === 'string'
    && typeof value.has_data === 'boolean'
    && isNullableString(value.timestamp)
    && (value.kpis === null || isRecord(value.kpis));
}

export function isBrandLeaderboardRow(value: unknown): value is BrandLeaderboardRow {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.classification === 'string'
    && typeof value.visibility_score === 'number'
    && Array.isArray(value.engines);
}

export function isSourceRow(value: unknown): value is SourceRow {
  return isRecord(value)
    && typeof value.domain === 'string'
    && typeof value.owned === 'boolean'
    && typeof value.citations === 'number'
    && Array.isArray(value.engines);
}

export function isKeywordTrend(value: unknown): value is KeywordTrend {
  return isRecord(value)
    && typeof value.keyword === 'string'
    && typeof value.period === 'string'
    && isRecord(value.kpis)
    && (value.change === null || isRecord(value.change));
}

type GapSummary = NonNullable<CitationGapsResponse['keyword_summaries']>[number];

export function isGapSummary(value: unknown): value is GapSummary {
  return isRecord(value)
    && typeof value.keyword === 'string'
    && typeof value.gap_count === 'number'
    && typeof value.high_priority_gaps === 'number'
    && typeof value.coverage_rate === 'number';
}

export function isCitationGap(value: unknown): value is CitationGap {
  return isRecord(value)
    && typeof value.url === 'string'
    && typeof value.domain === 'string'
    && typeof value.priority === 'string';
}

export function isRecommendation(value: unknown): value is Recommendation {
  return isRecord(value)
    && typeof value.type === 'string'
    && typeof value.title === 'string'
    && typeof value.priority === 'string';
}

export function isOutrankedKeyword(value: unknown): value is CompetitorOutrankedKeyword {
  return isRecord(value)
    && typeof value.keyword === 'string'
    && typeof value.their_best_rank === 'number'
    && Array.isArray(value.providers);
}

export function isOutreachTarget(value: unknown): value is CompetitorExclusiveSource {
  return isRecord(value)
    && typeof value.url === 'string'
    && typeof value.domain === 'string'
    && typeof value.lift_score === 'number';
}
