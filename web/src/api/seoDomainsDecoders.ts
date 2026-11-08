/**
 * Runtime guards for the Domain Overview and SEO recommendation answers
 * (`web/src/types/api/seoDomains.ts`, one-to-one). Every response of
 * `./seoDomains` passes one of the `is*Response` guards before it reaches a caller.
 */
import {
  isAllowedString, isFiniteNumber as isNumber, isNullableString, isRecord, isStringArray
} from './contentStudioDecoderPrimitives';
import {
  hasSeoScope, isExportAnswer, isKeywordIntent, isPaidAnswer
} from './seoDecoders';
import { isNullableNumber } from '../types/domain/insightFactDecoders';
import { RECOMMENDATION_STATUSES } from './recommendations';
import type {
  DomainKeywordsResponse,
  DomainOverviewResponse,
  DomainPagesResponse,
  DomainScope,
  DomainSnapshotSummary,
  DomainSnapshotScheduleResponse,
  DomainSnapshotsResponse,
  DomainTarget,
  PositionBucket,
  RankedKeywordRow,
  SeoInsightsResponse,
  SeoRecommendation,
  SeoRecommendationType,
  SerpCompetitorRow,
  SerpCompetitorsResponse,
  TakeSnapshotResponse,
  TopPageRow,
} from '../types/api/seoDomains';

const SCOPES: readonly DomainScope[] = ['exact_url', 'subfolder', 'domain', 'subdomains'];
const RECOMMENDATION_TYPES: readonly SeoRecommendationType[] = ['aio_missing_you', 'aio_competitor_cited', 'ai_gap', 'seo_gap'];
const PRIORITIES: readonly SeoRecommendation['priority'][] = ['high', 'medium', 'low'];

const isString = (value: unknown): value is string => typeof value === 'string';
const isOptionalString = (value: unknown): value is string | undefined => value === undefined || isString(value);

/** `value` is an array whose every entry passes `isItem`. */
const isListOf = <T,>(value: unknown, isItem: (item: unknown) => item is T): value is T[] => Array.isArray(value)
  && value.every((item) => isItem(item));

const isScope = (value: unknown): value is DomainScope => isAllowedString(value, SCOPES);
const isRecommendationType = (value: unknown): value is SeoRecommendationType => isAllowedString(value, RECOMMENDATION_TYPES);
const isPriority = (value: unknown): value is SeoRecommendation['priority'] => isAllowedString(value, PRIORITIES);
const isStatus = (value: unknown): value is SeoRecommendation['status'] => isAllowedString(value, RECOMMENDATION_STATUSES);

/** The domain and market a snapshot answer is about. */
function isDomainInMarket(value: Record<string, unknown>): boolean {
  return isString(value.domain) && isString(value.market_id);
}

function isDomainTarget(value: Record<string, unknown>): value is Record<string, unknown> & DomainTarget {
  return isString(value.target)
    && isString(value.hostname)
    && isScope(value.scope)
    && isString(value.path)
    && isString(value.market_id);
}

export function isPositionBucket(value: unknown): value is PositionBucket {
  return isRecord(value) && isString(value.label) && isNumber(value.keywords);
}

function hasOverviewFigures(value: Record<string, unknown>): boolean {
  return isNullableNumber(value.organic_keywords)
    && isNullableNumber(value.estimated_traffic)
    && isNullableNumber(value.traffic_cost)
    && isListOf(value.position_buckets, isPositionBucket);
}

export function isDomainOverviewResponse(value: unknown): value is DomainOverviewResponse {
  return isRecord(value)
    && isDomainTarget(value)
    && isPaidAnswer(value)
    && typeof value.domain_wide === 'boolean'
    && typeof value.has_data === 'boolean'
    && hasOverviewFigures(value);
}

function hasRankedKeywordMetrics(value: Record<string, unknown>): boolean {
  return isNullableNumber(value.search_volume)
    && isNullableNumber(value.etv)
    && isNullableNumber(value.cpc)
    && isNullableNumber(value.keyword_difficulty);
}

export function isRankedKeywordRow(value: unknown): value is RankedKeywordRow {
  return isRecord(value)
    && isString(value.keyword)
    && isNullableNumber(value.position)
    && isNullableNumber(value.organic_position)
    && hasRankedKeywordMetrics(value)
    && isNullableString(value.url)
    && isNullableString(value.relative_url)
    && isKeywordIntent(value.intent);
}

export function isTopPageRow(value: unknown): value is TopPageRow {
  return isRecord(value)
    && isString(value.url)
    && isNullableString(value.relative_url)
    && isNullableNumber(value.etv)
    && isNullableNumber(value.keywords);
}

function isPagedResponse<T>(value: unknown, isRow: (item: unknown) => item is T): boolean {
  return isRecord(value)
    && isDomainTarget(value)
    && isPaidAnswer(value)
    && isExportAnswer(value)
    && isNumber(value.page)
    && isNumber(value.page_size)
    && isNullableNumber(value.total_count)
    && typeof value.has_more === 'boolean'
    && isListOf(value.items, isRow);
}

export function isDomainKeywordsResponse(value: unknown): value is DomainKeywordsResponse {
  return isPagedResponse(value, isRankedKeywordRow);
}

export function isDomainPagesResponse(value: unknown): value is DomainPagesResponse {
  return isPagedResponse(value, isTopPageRow);
}

export function isSerpCompetitorRow(value: unknown): value is SerpCompetitorRow {
  return isRecord(value)
    && isString(value.domain)
    && isNullableNumber(value.avg_position)
    && isNullableNumber(value.median_position)
    && isNullableNumber(value.visibility)
    && isNullableNumber(value.etv)
    && isNullableNumber(value.keywords_count);
}

export function isSerpCompetitorsResponse(value: unknown): value is SerpCompetitorsResponse {
  return isRecord(value)
    && isPaidAnswer(value)
    && isString(value.market_id)
    && isNumber(value.keywords_count)
    && isListOf(value.items, isSerpCompetitorRow);
}

export function isDomainSnapshotSummary(value: unknown): value is DomainSnapshotSummary {
  return isRecord(value)
    && isDomainInMarket(value)
    && isString(value.snapshot_at)
    && hasOverviewFigures(value)
    && isNumber(value.keywords_stored);
}

export function isDomainSnapshotsResponse(value: unknown): value is DomainSnapshotsResponse {
  return isRecord(value)
    && isDomainInMarket(value)
    && isString(value.source)
    && typeof value.estimated === 'boolean'
    && isListOf(value.snapshots, isDomainSnapshotSummary);
}

export function isDomainSnapshotScheduleResponse(value: unknown): value is DomainSnapshotScheduleResponse {
  return isRecord(value) && typeof value.schedule_enabled === 'boolean';
}

export function isTakeSnapshotResponse(value: unknown): value is TakeSnapshotResponse {
  return isRecord(value)
    && isDomainInMarket(value)
    && isString(value.execution);
}

function hasRecommendationText(value: Record<string, unknown>): boolean {
  return isString(value.title)
    && isString(value.description)
    && isString(value.action)
    && isString(value.impact)
    && isStringArray(value.keywords);
}

function hasStatusNotes(value: Record<string, unknown>): boolean {
  return isOptionalString(value.notes) && isOptionalString(value.related_keyword) && isOptionalString(value.related_content_id);
}

export function isSeoRecommendation(value: unknown): value is SeoRecommendation {
  return isRecord(value)
    && isString(value.id)
    && isRecommendationType(value.type)
    && isPriority(value.priority)
    && hasRecommendationText(value)
    && isStatus(value.status)
    && hasStatusNotes(value);
}

export function isSeoInsightsResponse(value: unknown): value is SeoInsightsResponse {
  return isRecord(value)
    && hasSeoScope(value)
    && isListOf(value.recommendations, isSeoRecommendation)
    && isNumber(value.total_count);
}
