/**
 * Runtime guards for the local SEO API (`./seoLocal`); they mirror `web/src/types/api/seoLocal.ts`.
 * Every response passes one of the exported `is*Response` / `isLocalJob` guards before it reaches a caller.
 */
import {
  isAllowedString, isFiniteNumber, isNullableString, isRecord, isStringArray
} from './contentStudioDecoderPrimitives';
import { isPaidAnswer } from './seoDecoders';
import { isNullableNumber } from '../types/domain/insightFactDecoders';
import type {
  BusinessListing,
  BusinessProfile,
  BusinessQuestion,
  BusinessReview,
  BusinessSearchResponse,
  BusinessUpdate,
  CategoriesResponse,
  GridPoint,
  GridResult,
  LocalBusiness,
  LocalJob,
  LocalResultItem,
  LocalSerpResponse,
  ProfileResponse,
  QuestionsResponse,
  ReviewsResult,
  StartJobResponse,
  UpdatesResult,
} from '../types/api/seoLocal';

const STARS = ['1', '2', '3', '4', '5'] as const;
const JOB_STATUSES = ['queued', 'collecting', 'completed', 'failed', 'timed_out'] as const;
const POINT_STATUSES = ['ready', 'pending', 'failed'] as const;

type Guard = (value: unknown) => boolean;

function allOf(value: unknown, isItem: Guard): boolean {
  return Array.isArray(value) && value.every(isItem);
}

function hasNullableTexts(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => isNullableString(value[field]));
}

function hasNullableNumbers(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => isNullableNumber(value[field]));
}

function isStarCounts(value: unknown): boolean {
  return isRecord(value) && STARS.every((star) => isFiniteNumber(value[star]));
}

function isNullableBoolean(value: unknown): boolean {
  return value === null || typeof value === 'boolean';
}

function isLocalBusiness(value: unknown): value is LocalBusiness {
  return isRecord(value)
    && typeof value.title === 'string'
    && isStringArray(value.additional_categories)
    && hasNullableTexts(value, ['category', 'address', 'phone', 'url', 'domain', 'cid', 'place_id'])
    && hasNullableNumbers(value, ['rating', 'reviews_count', 'latitude', 'longitude', 'total_photos'])
    && isNullableBoolean(value.is_claimed);
}

function isListing(value: unknown): value is BusinessListing {
  return isLocalBusiness(value) && isRecord(value) && hasNullableTexts(value, ['description', 'check_url']);
}

function isTimetable(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

function isBusinessProfile(value: unknown): value is BusinessProfile {
  return isLocalBusiness(value) && isRecord(value)
    && hasNullableTexts(value, ['description', 'current_status', 'check_url'])
    && isStarCounts(value.rating_distribution)
    && isTimetable(value.timetable);
}

function isResultItem(value: unknown): value is LocalResultItem {
  return isLocalBusiness(value) && isRecord(value) && hasNullableNumbers(value, ['rank_group', 'rank_absolute']);
}

function isPosted(value: Record<string, unknown>, kind: 'question' | 'answer'): boolean {
  return typeof value[`${kind}_text`] === 'string'
    && hasNullableTexts(value, [`${kind}_id`, 'profile_name', 'time_ago', 'timestamp']);
}

function isAnswer(value: unknown): boolean {
  return isRecord(value) && isPosted(value, 'answer');
}

function isQuestion(value: unknown): value is BusinessQuestion {
  return isRecord(value) && isPosted(value, 'question') && allOf(value.answers, isAnswer);
}

export function isCategoriesResponse(value: unknown): value is CategoriesResponse {
  return isRecord(value) && isFiniteNumber(value.total) && allOf(value.categories, (row) => (
    isRecord(row) && typeof row.category === 'string' && isNullableNumber(row.business_count)
  ));
}

export function isBusinessSearchResponse(value: unknown): value is BusinessSearchResponse {
  return isRecord(value) && isPaidAnswer(value) && allOf(value.businesses, isListing)
    && (value.center === null || isRecord(value.center));
}

export function isProfileResponse(value: unknown): value is ProfileResponse {
  return isRecord(value) && isPaidAnswer(value) && (value.profile === null || isBusinessProfile(value.profile));
}

export function isQuestionsResponse(value: unknown): value is QuestionsResponse {
  return isRecord(value) && isPaidAnswer(value) && allOf(value.questions, isQuestion);
}

function isMatch(value: unknown): boolean {
  return value === null || (isRecord(value) && isFiniteNumber(value.index) && isNullableNumber(value.rank)
    && hasNullableTexts(value, ['title', 'cid', 'place_id']));
}

export function isLocalSerpResponse(value: unknown): value is LocalSerpResponse {
  return isRecord(value) && isPaidAnswer(value)
    && typeof value.keyword === 'string'
    && isAllowedString(value.search_type, ['maps', 'local_finder'])
    && allOf(value.items, isResultItem)
    && isMatch(value.match)
    && isNullableString(value.check_url);
}

function isReview(value: unknown): value is BusinessReview {
  return isRecord(value) && isNullableNumber(value.rating) && typeof value.local_guide === 'boolean'
    && hasNullableTexts(value, ['review_id', 'timestamp', 'time_ago', 'review_text', 'profile_name', 'owner_answer', 'owner_timestamp']);
}

function isReviewsResult(value: unknown): value is ReviewsResult {
  return isRecord(value) && isRecord(value.totals) && allOf(value.reviews, isReview)
    && isRecord(value.summary) && isStarCounts(value.summary.histogram)
    && isNullableNumber(value.summary.owner_response_rate);
}

function isUpdate(value: unknown): value is BusinessUpdate {
  return isRecord(value) && hasNullableTexts(value, ['author', 'post_date', 'timestamp', 'post_text', 'url'])
    && allOf(value.links, (link) => isRecord(link) && hasNullableTexts(link, ['title', 'url']));
}

function isUpdatesResult(value: unknown): value is UpdatesResult {
  return isRecord(value) && allOf(value.updates, isUpdate);
}

function isGridPoint(value: unknown): value is GridPoint {
  return isRecord(value)
    && ['index', 'row', 'col', 'latitude', 'longitude'].every((field) => isFiniteNumber(value[field]))
    && isAllowedString(value.status, POINT_STATUSES)
    && hasNullableNumbers(value, ['rank', 'results_count'])
    && (value.top_result === null || isRecord(value.top_result));
}

function isGridResult(value: unknown): value is GridResult {
  return isRecord(value) && allOf(value.points, isGridPoint) && isRecord(value.summary)
    && ['points_total', 'points_searched', 'points_failed', 'points_found', 'top3_count', 'top10_count']
      .every((field) => isRecord(value.summary) && isFiniteNumber(value.summary[field]))
    && isNullableNumber(value.summary.average_rank);
}

const RESULT_GUARDS: Record<LocalJob['kind'], Guard> = {
  reviews: isReviewsResult,
  updates: isUpdatesResult,
  grid: isGridResult,
};

function isProgress(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.ready) && isFiniteNumber(value.total);
}

export function isLocalJob(value: unknown): value is LocalJob {
  if (!isRecord(value) || !isAllowedString(value.kind, ['reviews', 'updates', 'grid'])) return false;
  const isResult = RESULT_GUARDS[value.kind];
  return ['job_id', 'created_at', 'updated_at'].every((field) => typeof value[field] === 'string')
    && isAllowedString(value.status, JOB_STATUSES)
    && isProgress(value.progress)
    && hasNullableTexts(value, ['error_code', 'error'])
    && (value.result === null || isResult(value.result));
}

export function isStartJobResponse(value: unknown): value is StartJobResponse {
  return isRecord(value) && typeof value.job_id === 'string' && typeof value.reused === 'boolean' && isLocalJob(value.job);
}
