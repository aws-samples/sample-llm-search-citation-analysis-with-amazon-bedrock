/**
 * Runtime guards for the page performance API (`./seoPerformance`); they mirror
 * `web/src/types/api/seoPerformance.ts`. Every response passes one of the exported guards before it
 * reaches a caller.
 */
import {
  isAllowedString, isFiniteNumber, isNullableString, isRecord, isStringArray
} from './contentStudioDecoderPrimitives';
import { isNullableNumber } from '../types/domain/insightFactDecoders';
import type {
  AuditPagesResponse,
  CompletedResult,
  CreateKeyResponse,
  EngineAnswer,
  HostSubmission,
  IndexNowSetup,
  IndexNowSite,
  IndexNowSubmission,
  KeyFileCheck,
  KeyFileHostCheck,
  KeyFileLocation,
  KeyFileStatus,
  LighthouseAudit,
  LighthouseDevice,
  LighthouseResult,
  LighthouseRun,
  LighthouseRunHeader,
  LighthouseSample,
  RunResponse,
  RunsResponse,
  SampleAudit,
  StartRunResponse,
  SubmitResponse,
} from '../types/api/seoPerformance';

const DEVICES: readonly LighthouseDevice[] = ['mobile', 'desktop'];
const SCORE_KEYS = ['performance', 'accessibility', 'best_practices', 'seo'] as const;
const METRIC_KEYS = ['lcp_ms', 'cls', 'inp_ms', 'ttfb_ms', 'fcp_ms', 'tbt_ms', 'speed_index_ms'] as const;
const SEVERITIES = ['critical', 'warning', 'info'] as const;
const RUN_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
const RUN_KINDS = ['single', 'batch'] as const;
const KEY_FILE_STATUSES: readonly KeyFileStatus[] = [
  'found', 'missing', 'wrong_content', 'redirects', 'moved', 'unreachable', 'unknown',
];
const ENGINES = ['bing', 'yandex', 'yep'] as const;
const HOST_STATUSES = ['submitted', 'failed', 'not_sent'] as const;
const SOURCES = ['paste', 'audit'] as const;

/** Whether `value` is an array whose every entry passes `accepts`. */
function eachEntry(value: unknown, accepts: (entry: unknown) => boolean): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => accepts(entry));
}

function hasNullableNumbers(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && keys.every((key) => isNullableNumber(value[key]));
}

function isTarget(value: Record<string, unknown>): boolean {
  return typeof value.url === 'string' && isAllowedString(value.device, DEVICES);
}

function isAudit(value: unknown): value is LighthouseAudit {
  return isRecord(value)
    && typeof value.id === 'string'
    && isAllowedString(value.category, SCORE_KEYS)
    && typeof value.title === 'string'
    && typeof value.description === 'string'
    && isNullableString(value.display_value)
    && hasNullableNumbers(value, ['score', 'savings_ms', 'savings_bytes'])
    && isAllowedString(value.severity, SEVERITIES);
}

function isCompleted(value: Record<string, unknown>): value is Record<string, unknown> & CompletedResult {
  return typeof value.final_url === 'string'
    && isNullableString(value.lighthouse_version)
    && hasNullableNumbers(value.scores, SCORE_KEYS)
    && hasNullableNumbers(value.metrics, METRIC_KEYS)
    && eachEntry(value.failed_audits, isAudit)
    && typeof value.fetched_at === 'string';
}

function isResult(value: unknown): value is LighthouseResult {
  if (!isRecord(value) || !isTarget(value)) return false;
  switch (value.status) {
    case 'measuring':
      return true;
    case 'failed':
      return typeof value.error === 'string';
    case 'completed':
      return isCompleted(value);
    default:
      return false;
  }
}

function isRunHeader(value: unknown): value is LighthouseRunHeader {
  return isRecord(value)
    && typeof value.run_id === 'string'
    && isAllowedString(value.kind, RUN_KINDS)
    && isAllowedString(value.status, RUN_STATUSES)
    && typeof value.created_at === 'string'
    && isNullableString(value.started_by)
    && isNullableString(value.audit_id)
    && isFiniteNumber(value.target_count)
    && isNullableString(value.first_url);
}

function isTargetRecord(value: unknown): boolean {
  return isRecord(value) && isTarget(value);
}

function isRun(value: unknown): value is LighthouseRun {
  return isRunHeader(value)
    && isRecord(value)
    && isNullableString(value.updated_at)
    && eachEntry(value.targets, isTargetRecord)
    && eachEntry(value.results, (result) => result === null || isResult(result))
    && isRecord(value.progress) && isFiniteNumber(value.progress.done) && isFiniteNumber(value.progress.total)
    && isNullableString(value.error);
}

export function isStartRunResponse(value: unknown): value is StartRunResponse {
  return isRecord(value) && isRun(value.run) && typeof value.reused === 'boolean';
}

export function isRunResponse(value: unknown): value is RunResponse {
  return isRecord(value) && isRun(value.run);
}

export function isRunsResponse(value: unknown): value is RunsResponse {
  return isRecord(value) && eachEntry(value.runs, isRunHeader);
}

function isSampleAudit(value: unknown): value is SampleAudit {
  return isRecord(value)
    && typeof value.audit_id === 'string'
    && isNullableString(value.start_url)
    && isNullableString(value.completed_at)
    && isNullableNumber(value.pages_crawled);
}

export function isLighthouseSample(value: unknown): value is LighthouseSample {
  return isRecord(value)
    && (value.audit === null || isSampleAudit(value.audit))
    && isStringArray(value.pages)
    && eachEntry(value.devices, (device) => isAllowedString(device, DEVICES))
    && isFiniteNumber(value.target_count);
}

function isKeyFileLocation(value: unknown): value is KeyFileLocation {
  return isRecord(value) && typeof value.host === 'string' && typeof value.url === 'string';
}

function isSite(value: unknown): value is IndexNowSite {
  return isRecord(value)
    && typeof value.domain === 'string'
    && isNullableString(value.key)
    && eachEntry(value.key_files, isKeyFileLocation);
}

function isEngineAnswer(value: unknown): value is EngineAnswer {
  return isRecord(value)
    && isAllowedString(value.engine, ENGINES)
    && isNullableNumber(value.http_status)
    && typeof value.message === 'string';
}

function isHostSubmission(value: unknown): value is HostSubmission {
  return isRecord(value)
    && typeof value.host === 'string'
    && isFiniteNumber(value.url_count)
    && isAllowedString(value.status, HOST_STATUSES)
    && typeof value.message === 'string'
    && (value.key_file === null || isAllowedString(value.key_file, KEY_FILE_STATUSES))
    && eachEntry(value.engines, isEngineAnswer);
}

function isSubmission(value: unknown): value is IndexNowSubmission {
  return isRecord(value)
    && typeof value.submitted_at === 'string'
    && typeof value.submitted_by === 'string'
    && isAllowedString(value.source, SOURCES)
    && isFiniteNumber(value.url_count)
    && isFiniteNumber(value.skipped_count)
    && isStringArray(value.skipped_examples)
    && eachEntry(value.hosts, isHostSubmission);
}

export function isIndexNowSetup(value: unknown): value is IndexNowSetup {
  return isRecord(value)
    && eachEntry(value.sites, isSite)
    && eachEntry(value.history, isSubmission)
    && isFiniteNumber(value.max_urls);
}

export function isCreateKeyResponse(value: unknown): value is CreateKeyResponse {
  return isRecord(value) && isSite(value.site) && typeof value.created === 'boolean';
}

function isHostCheck(value: unknown): value is KeyFileHostCheck {
  return isKeyFileLocation(value)
    && isRecord(value)
    && isAllowedString(value.status, KEY_FILE_STATUSES)
    && isNullableString(value.problem);
}

export function isKeyFileCheck(value: unknown): value is KeyFileCheck {
  return isRecord(value) && typeof value.domain === 'string' && eachEntry(value.hosts, isHostCheck);
}

export function isAuditPagesResponse(value: unknown): value is AuditPagesResponse {
  return isRecord(value) && eachEntry(value.pages, (page) => isRecord(page) && typeof page.url === 'string');
}

export function isSubmitResponse(value: unknown): value is SubmitResponse {
  return isRecord(value) && isSubmission(value.submission);
}
