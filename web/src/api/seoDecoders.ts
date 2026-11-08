/**
 * Runtime guards for the SEO API (`${SEO_API_BASE_URL}/seo/...`).
 *
 * Every response of `./seo` passes one of the `is*Response` guards before it
 * reaches a caller; the field-level guards mirror `web/src/types/api/seo.ts`
 * one-to-one and are exported for the specs.
 */
import {
  isFiniteNumber as isNumber, isNullableString, isRecord, isStringArray
} from './contentStudioDecoderPrimitives';
import { isNullableNumber } from '../types/domain/insightFactDecoders';
import type {
  KeywordDataSource,
  KeywordIntent,
  KeywordResearchResponse,
  KeywordRow,
  MonthlySearch,
  OrganicItem,
  OrganicPositionSource,
  SeoAccount,
  SeoGeoQuadrant,
  SeoGeoResponse,
  SeoGeoRow,
  SeoGeoSummary,
  SerpResponse,
  TrafficShareEntry,
} from '../types/api/seo';

export class InvalidSeoResponseError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSeoResponseError';
  }
}

const KEYWORD_INTENTS: readonly KeywordIntent[] = ['informational', 'commercial', 'transactional', 'navigational', 'unknown'];
const DATA_SOURCES: readonly KeywordDataSource[] = ['labs', 'google_ads'];
const QUADRANTS: readonly SeoGeoQuadrant[] = ['both_strong', 'ai_gap', 'seo_gap', 'both_weak', 'no_data'];
const POSITION_SOURCES: readonly OrganicPositionSource[] = ['serp_top10', 'ranked_keywords', 'rank_tracking'];
const SUMMARY_KEYS: readonly (keyof SeoGeoSummary)[] = QUADRANTS;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

function isListOf<T>(value: unknown, isItem: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(isItem);
}

function isOneOf<T extends string>(choices: readonly T[]) {
  return (value: unknown): value is T => typeof value === 'string' && choices.some((choice) => choice === value);
}

export const isKeywordIntent = isOneOf(KEYWORD_INTENTS);
const isDataSource = isOneOf(DATA_SOURCES);
const isQuadrant = isOneOf(QUADRANTS);
const isPositionSource = isOneOf(POSITION_SOURCES);

export function isMonthlySearch(value: unknown): value is MonthlySearch {
  return isRecord(value) && isNumber(value.year) && isNumber(value.month) && isNumber(value.search_volume);
}

/** The metric fields a research row and a stored metric share. */
function hasKeywordMetrics(value: Record<string, unknown>): boolean {
  return isString(value.keyword)
    && isNullableNumber(value.search_volume)
    && isNullableNumber(value.keyword_difficulty)
    && isNullableNumber(value.cpc)
    && isNullableNumber(value.competition);
}

/** The cache flag and fetch time every paid SEO lookup answers with. */
export function isPaidAnswer(value: Record<string, unknown>): boolean {
  return typeof value.cached === 'boolean' && isString(value.fetched_at);
}

function isExportPricing(value: unknown): boolean {
  return isRecord(value)
    && isNumber(value.max_rows)
    && isNumber(value.rows_per_request)
    && isNumber(value.request_usd)
    && isNumber(value.row_usd)
    && isNumber(value.cache_hours);
}

/** The export window (`offset`, `limit`, null on a page) and the `export` pricing of a DataForSEO-paged table answer. */
export function isExportAnswer(value: Record<string, unknown>): boolean {
  return isNullableNumber(value.offset) && isNullableNumber(value.limit) && isExportPricing(value.export);
}

export function isKeywordRow(value: unknown): value is KeywordRow {
  return isRecord(value)
    && hasKeywordMetrics(value)
    && isListOf(value.trend, isMonthlySearch)
    && isKeywordIntent(value.intent);
}

export function isOrganicItem(value: unknown): value is OrganicItem {
  return isRecord(value)
    && isNumber(value.position)
    && isNullableNumber(value.rank_absolute)
    && isString(value.url)
    && isString(value.domain)
    && isString(value.title)
    && isString(value.description);
}

function hasResearchMarket(value: Record<string, unknown>): boolean {
  return isString(value.keyword)
    && isString(value.market_id)
    && isNumber(value.location_code)
    && isString(value.language_code)
    && isDataSource(value.data_source);
}

export function isKeywordResearchResponse(value: unknown): value is KeywordResearchResponse {
  return isRecord(value)
    && hasResearchMarket(value)
    && isString(value.source)
    && typeof value.used_fallback === 'boolean'
    && isListOf(value.rows, isKeywordRow)
    && isPaidAnswer(value);
}

export function isSerpResponse(value: unknown): value is SerpResponse {
  return isRecord(value)
    && isString(value.keyword)
    && isString(value.market_id)
    && isNumber(value.depth)
    && isListOf(value.items, isOrganicItem)
    && isStringArray(value.item_types)
    && typeof value.has_ai_overview === 'boolean'
    && isNullableString(value.check_url)
    && typeof value.cached === 'boolean'
    && isString(value.fetched_at);
}

export function isSeoAccount(value: unknown): value is SeoAccount {
  return isRecord(value)
    && typeof value.configured === 'boolean'
    && isNullableString(value.login)
    && isNullableNumber(value.balance_usd);
}

function isCompetitorPositions(value: unknown): value is Record<string, number | null> {
  return isRecord(value) && Object.values(value).every(isNullableNumber);
}

function hasSeoGeoSignals(value: Record<string, unknown>): boolean {
  return isNullableNumber(value.search_volume)
    && isNullableNumber(value.organic_position)
    && isCompetitorPositions(value.competitor_positions)
    && isNullableBoolean(value.ai_overview_shown)
    && isNullableBoolean(value.ai_overview_cites_you)
    && isNullableNumber(value.ai_mention_rate)
    && isNullableNumber(value.citation_overlap);
}

/** The organic signals beyond the AI Overviews results page: a deeper position and estimated traffic. */
function hasOrganicSignals(value: Record<string, unknown>): boolean {
  return isNullableNumber(value.ranked_position)
    && (value.organic_position_source === null || isPositionSource(value.organic_position_source))
    && isNullableNumber(value.estimated_traffic)
    && isStringArray(value.ai_overview_cited_competitors);
}

export function isSeoGeoRow(value: unknown): value is SeoGeoRow {
  return isRecord(value)
    && isString(value.keyword_id)
    && isString(value.keyword)
    && hasSeoGeoSignals(value)
    && hasOrganicSignals(value)
    && isNumber(value.answers)
    && isQuadrant(value.quadrant)
    && isNullableString(value.last_run);
}

export function isSeoGeoSummary(value: unknown): value is SeoGeoSummary {
  return isRecord(value) && SUMMARY_KEYS.every((key) => isNumber(value[key]));
}

function isSeoGeoThresholds(value: unknown): value is SeoGeoResponse['thresholds'] {
  return isRecord(value) && isNumber(value.seo_top_position) && isNumber(value.geo_mention_rate);
}

export function isTrafficShareEntry(value: unknown): value is TrafficShareEntry {
  return isRecord(value)
    && isString(value.name)
    && typeof value.owned === 'boolean'
    && isNullableNumber(value.estimated_traffic)
    && isNullableNumber(value.traffic_share)
    && isNullableNumber(value.share_of_voice);
}

/** The scope every SEO vs GEO read answers with: its market, its keyword group and when it was computed. */
export function hasSeoScope(value: Record<string, unknown>): boolean {
  return isString(value.market_id) && isNullableString(value.group_id) && isString(value.generated_at);
}

export function isSeoGeoResponse(value: unknown): value is SeoGeoResponse {
  return isRecord(value)
    && hasSeoScope(value)
    && isSeoGeoThresholds(value.thresholds)
    && isSeoGeoSummary(value.summary)
    && isListOf(value.rows, isSeoGeoRow)
    && isListOf(value.traffic_comparison, isTrafficShareEntry)
    && isNullableString(value.traffic_snapshot_at);
}

/** `payload` when `isValid` accepts it; an `InvalidSeoResponseError` naming `what` otherwise. */
export function decodeSeo<T>(payload: unknown, isValid: (value: unknown) => value is T, what: string): T {
  if (!isValid(payload)) {
    throw new InvalidSeoResponseError(`SEO API returned an invalid ${what}`);
  }
  return payload;
}
