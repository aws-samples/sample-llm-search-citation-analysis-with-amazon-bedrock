/**
 * Types and runtime guards of the re-extract API (`lambda/api/manage-reextract.py`, 2.55.0): re-running the brand
 * extraction on stored answers. Every answer is checked here before the dashboard reads it.
 */
import {
  isNullableString, isRecord
} from '../types/domain/keywordDecoders';
import { isStringArray } from './contentStudioDecoderPrimitives';

/** What a re-extract covers: the request body of the estimate and the start, echoed back as `filters`. */
export interface ReextractFilters {
  readonly group_ids?: readonly string[];
  readonly keyword_ids?: readonly string[];
  readonly since?: string | null;
  readonly until?: string | null;
  readonly only_outdated?: boolean;
}

export interface ReextractEstimate {
  readonly answers: number;
  readonly answers_current: number;
  readonly keywords: number;
  readonly estimated_cost_usd: number;
  readonly model: string;
  readonly brands_version: number;
  readonly truncated: boolean;
  readonly filters: ReextractFilters;
}

export type ReextractJobStatus = 'running' | 'stopping' | 'stopped' | 'done' | 'failed';

export interface ReextractJob {
  readonly job_id: string;
  readonly status: ReextractJobStatus;
  readonly created_at: string;
  readonly created_by: string;
  readonly finished_at: string | null;
  readonly filters: ReextractFilters;
  readonly brands_version: number;
  readonly answers_total: number;
  readonly answers_done: number;
  readonly answers_skipped: number;
  readonly answers_failed: number;
  readonly keywords_total: number;
  readonly keywords_done: number;
  readonly estimated_cost_usd: number;
  readonly error: string | null;
  readonly rebuild: string | null;
  /** The job stopped at the answer count its estimate showed (the count was cut by the request time budget). */
  readonly capped?: boolean;
}

/** `GET /api/reextract`: the newest job, and whether one is active. */
export interface ReextractStatus {
  readonly job: ReextractJob | null;
  readonly active: boolean;
}

const JOB_STATUSES: ReadonlySet<unknown> = new Set<ReextractJobStatus>(['running', 'stopping', 'stopped', 'done', 'failed']);

/** A whole, non-negative count. */
function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isCost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isOptionalStringList(value: unknown): boolean {
  return value === undefined || isStringArray(value);
}

function isOptionalDate(value: unknown): boolean {
  return value === undefined || isNullableString(value);
}

export function isReextractFilters(value: unknown): value is ReextractFilters {
  return isRecord(value)
    && isOptionalStringList(value.group_ids)
    && isOptionalStringList(value.keyword_ids)
    && isOptionalDate(value.since)
    && isOptionalDate(value.until)
    && (value.only_outdated === undefined || typeof value.only_outdated === 'boolean');
}

export function isReextractEstimate(value: unknown): value is ReextractEstimate {
  return isRecord(value)
    && isCount(value.answers)
    && isCount(value.answers_current)
    && isCount(value.keywords)
    && isCost(value.estimated_cost_usd)
    && typeof value.model === 'string'
    && isCount(value.brands_version)
    && typeof value.truncated === 'boolean'
    && isReextractFilters(value.filters);
}

function hasJobIdentity(value: Record<string, unknown>): boolean {
  return typeof value.job_id === 'string'
    && JOB_STATUSES.has(value.status)
    && typeof value.created_at === 'string'
    && typeof value.created_by === 'string'
    && isNullableString(value.finished_at)
    && isReextractFilters(value.filters)
    && isCount(value.brands_version);
}

function hasJobProgress(value: Record<string, unknown>): boolean {
  return [
    value.answers_total, value.answers_done, value.answers_skipped, value.answers_failed,
    value.keywords_total, value.keywords_done,
  ].every(isCount)
    && isCost(value.estimated_cost_usd)
    && isNullableString(value.error)
    && isNullableString(value.rebuild)
    && (value.capped === undefined || typeof value.capped === 'boolean');
}

export function isReextractJob(value: unknown): value is ReextractJob {
  return isRecord(value) && hasJobIdentity(value) && hasJobProgress(value);
}

export function isReextractStatus(value: unknown): value is ReextractStatus {
  return isRecord(value)
    && (value.job === null || isReextractJob(value.job))
    && typeof value.active === 'boolean';
}

/** `{job}`: the answer of the start, the stop, the job read and the 409 refusal. */
export function isReextractJobEnvelope(value: unknown): value is { readonly job: ReextractJob } {
  return isRecord(value) && isReextractJob(value.job);
}
