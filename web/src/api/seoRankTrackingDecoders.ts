/**
 * Runtime guards for the rank tracking API, one-to-one with `web/src/types/api/seoRankTracking.ts`.
 * Every response of `./seoRankTracking` passes one of the `is*` guards here before it reaches a caller.
 */
import { isNullableNumber } from '../types/domain/insightFactDecoders';
import {
  isAllowedString, isFiniteNumber, isNullableString, isRecord, isStringArray
} from './contentStudioDecoderPrimitives';
import type {
  RankCell,
  RankDevice,
  RankDevices,
  RankEstimate,
  RankHistory,
  RankHistoryPoint,
  RankKeywordsChanged,
  RankResultRow,
  RankResults,
  RankResultStatus,
  RankRun,
  RankRunStarted,
  RankRunStatus,
  RankSchedule,
  RankTracker,
  RankTrackerDetail,
  RankTrackerList,
  RankTrackerSaved,
  RankTrend,
  RankTrendPoint,
  StoredRankKeywordScope,
  TrackedKeyword,
} from '../types/api/seoRankTracking';

type Guard<T> = (value: unknown) => value is T;

const isNumber = isFiniteNumber;
const isString: Guard<string> = (value): value is string => typeof value === 'string';

/** `value` is an array whose every entry passes `isItem`. */
function isListOf<T>(value: unknown, isItem: Guard<T>): value is T[] {
  return Array.isArray(value) ? value.every(isItem) : false;
}

const isOneOf = <T extends string>(allowed: readonly T[]): Guard<T> => (value): value is T => isAllowedString(value, allowed);

const isDevice = isOneOf<RankDevice>(['desktop', 'mobile']);
const isDevices = isOneOf<RankDevices>(['desktop', 'mobile', 'both']);
const isSchedule = isOneOf<RankSchedule>(['daily', 'weekly', 'monthly', 'manual']);
const isRunStatus = isOneOf<RankRunStatus>(['pending', 'running', 'completed', 'partial', 'failed']);
const isResultStatus = isOneOf<RankResultStatus>(['found', 'not_found', 'not_found_unconfirmed', 'not_checked']);
const isSource = isOneOf(['list', 'market', 'group'] as const);
const isStoredScope = isOneOf<StoredRankKeywordScope>(['all', 'group', 'list']);

function isCountMap(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isNumber);
}

function hasRunProgress(value: Record<string, unknown>): boolean {
  return isNumber(value.keywords_total)
    && isNumber(value.keywords_checked)
    && isCountMap(value.checked)
    && isNullableString(value.error_code)
    && isNullableString(value.error_message);
}

export function isRankRun(value: unknown): value is RankRun {
  return isRecord(value)
    && isString(value.run_id)
    && isRunStatus(value.status)
    && isString(value.trigger)
    && isString(value.method)
    && typeof value.is_subset === 'boolean'
    && isListOf(value.devices, isDevice)
    && hasRunProgress(value)
    && isString(value.started_at)
    && isNullableString(value.completed_at);
}

function isNullableRun(value: unknown): value is RankRun | null {
  return value === null || isRankRun(value);
}

function hasTrackerSchedule(value: Record<string, unknown>): boolean {
  return isSchedule(value.schedule)
    && isNullableString(value.next_check_at)
    && isNullableString(value.last_checked_at)
    && isNullableString(value.last_skip_reason)
    && isString(value.created_at)
    && isString(value.updated_at);
}

function hasTrackerKeywords(value: Record<string, unknown>): boolean {
  return isStoredScope(value.keyword_scope)
    && isNullableString(value.group_id)
    && isNumber(value.keyword_count)
    && isNumber(value.scope_keyword_count)
    && isNumber(value.extra_keyword_count)
    && isNumber(value.max_keywords);
}

export function isRankTracker(value: unknown): value is RankTracker {
  return isRecord(value)
    && isString(value.tracker_id)
    && isString(value.domain)
    && isString(value.market_id)
    && isDevices(value.devices)
    && isNumber(value.depth)
    && hasTrackerKeywords(value)
    && typeof value.is_active === 'boolean'
    && hasTrackerSchedule(value)
    && isNullableRun(value.latest_run);
}

function isDomainMap(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

export function isRankTrackerList(value: unknown): value is RankTrackerList {
  return isRecord(value)
    && isListOf(value.trackers, isRankTracker)
    && isStringArray(value.owned_domains)
    && isDomainMap(value.competitor_domains);
}

function isTrackedKeyword(value: unknown): value is TrackedKeyword {
  return isRecord(value) && isString(value.keyword_id) && isString(value.keyword) && isSource(value.source);
}

export function isRankTrackerDetail(value: unknown): value is RankTrackerDetail {
  return isRecord(value) && isRankTracker(value.tracker) && isListOf(value.keywords, isTrackedKeyword);
}

export function isRankTrackerSaved(value: unknown): value is RankTrackerSaved {
  return isRecord(value) && isRankTracker(value.tracker);
}

export function isRankEstimate(value: unknown): value is RankEstimate {
  return isRecord(value)
    && isNumber(value.keyword_count)
    && isNumber(value.scope_keyword_count)
    && isNumber(value.max_keywords)
    && isNumber(value.pairs)
    && isNumber(value.checks_per_month);
}

export function isRankRunStarted(value: unknown): value is RankRunStarted {
  return isRecord(value) && isRankRun(value.run);
}

export function isLatestRun(value: unknown): value is { run: RankRun | null } {
  return isRecord(value) && isNullableRun(value.run);
}

function isRankCell(value: unknown): value is RankCell {
  return isRecord(value)
    && isResultStatus(value.status)
    && isNullableNumber(value.position)
    && isNullableNumber(value.previous_position)
    && isNullableNumber(value.rank_absolute)
    && isNullableString(value.url)
    && isStringArray(value.serp_features)
    && isNullableString(value.checked_at);
}

function isNullableCell(value: unknown): value is RankCell | null {
  return value === null || isRankCell(value);
}

function isResultRow(value: unknown): value is RankResultRow {
  return isRecord(value)
    && isString(value.keyword_id)
    && isString(value.keyword)
    && isSource(value.source)
    && isNullableCell(value.desktop)
    && isNullableCell(value.mobile);
}

export function isRankResults(value: unknown): value is RankResults {
  return isRecord(value)
    && isString(value.tracker_id)
    && isOneOf(['1d', '7d', '30d', '90d'] as const)(value.period)
    && isListOf(value.devices, isDevice)
    && isNullableString(value.baseline_run_id)
    && isNullableString(value.baseline_started_at)
    && isListOf(value.rows, isResultRow);
}

function isHistoryPoint(value: unknown): value is RankHistoryPoint {
  return isRecord(value)
    && isDevice(value.device)
    && isString(value.checked_at)
    && isNullableNumber(value.position)
    && isResultStatus(value.status)
    && isNullableString(value.url);
}

export function isRankHistory(value: unknown): value is RankHistory {
  return isRecord(value)
    && isString(value.tracker_id)
    && isString(value.keyword_id)
    && isNumber(value.depth)
    && isListOf(value.points, isHistoryPoint);
}

const TREND_COUNTS = ['total', 'top3', 'top4_10', 'top11_20', 'not_ranking', 'not_checked'] as const;

function isTrendPoint(value: unknown): value is RankTrendPoint {
  return isRecord(value)
    && isString(value.run_id)
    && isString(value.started_at)
    && isDevice(value.device)
    && TREND_COUNTS.every((key) => isNumber(value[key]));
}

export function isRankTrend(value: unknown): value is RankTrend {
  return isRecord(value) && isString(value.tracker_id) && isNumber(value.days) && isListOf(value.points, isTrendPoint);
}

export function isRankKeywordsChanged(value: unknown): value is RankKeywordsChanged {
  return isRecord(value) && isNumber(value.keyword_count);
}
