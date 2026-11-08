/**
 * Runtime guards for the scoped-response contract (`scopeCoverage.ts`).
 *
 * `@public` marks contract exports the dashboard does not read yet (track S5
 * wires them into `api/client.ts` and the scoped hooks); knip skips them until then.
 */
import { isRecord } from './keywordDecoders';
import type {
  ComputingResponse,
  CursorExpiredBody,
  FailedViewJobResponse,
  ScopeCoverage,
  ScopedResponseFields,
  ScopeSource,
  ScopeSourceEnvelope,
} from './scopeCoverage';

const SCOPE_SOURCES: ReadonlySet<unknown> = new Set<ScopeSource>(['live', 'snapshot']);

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * `{keywords_total, keywords_analyzed, complete}` with whole counts, never more analyzed than exist.
 */
export function isScopeCoverage(value: unknown): value is ScopeCoverage {
  return isRecord(value)
    && isCount(value.keywords_total)
    && isCount(value.keywords_analyzed)
    && value.keywords_analyzed <= value.keywords_total
    && typeof value.complete === 'boolean';
}

/** @public */
export function isScopeSource(value: unknown): value is ScopeSource {
  return SCOPE_SOURCES.has(value);
}

/**
 * `source`, `as_of`, `stale`, `refreshing` all present and well-typed.
 * @public
 */
export function isScopeSourceEnvelope(value: unknown): value is ScopeSourceEnvelope {
  return isRecord(value)
    && isScopeSource(value.source)
    && (value.as_of === null || typeof value.as_of === 'string')
    && typeof value.stale === 'boolean'
    && typeof value.refreshing === 'boolean';
}

/**
 * The common fields of a scoped body: each one absent (older API builds) or well-typed.
 */
export function hasScopedResponseFields(value: Record<string, unknown>): value is Record<string, unknown> & ScopedResponseFields {
  return (value.coverage === undefined || isScopeCoverage(value.coverage))
    && (value.source === undefined || isScopeSource(value.source))
    && (value.as_of === undefined || value.as_of === null || typeof value.as_of === 'string')
    && (value.stale === undefined || typeof value.stale === 'boolean')
    && (value.refreshing === undefined || typeof value.refreshing === 'boolean');
}

/**
 * A `202` body: a view job is computing the answer.
 */
export function isComputingResponse(value: unknown): value is ComputingResponse {
  return isRecord(value)
    && value.status === 'computing'
    && isRecord(value.job)
    && typeof value.job.id === 'string'
    && typeof value.job.started_at === 'string'
    && typeof value.retry_after_ms === 'number'
    && value.retry_after_ms > 0;
}

/**
 * A `200` body of a view job that failed.
 */
export function isFailedViewJobResponse(value: unknown): value is FailedViewJobResponse {
  return isRecord(value) && value.status === 'failed' && typeof value.message === 'string';
}

/**
 * A `400` body asking the client to restart a list.
 */
export function isCursorExpiredBody(value: unknown): value is CursorExpiredBody {
  return isRecord(value)
    && value.code === 'cursor_expired'
    && typeof value.error === 'string'
    && typeof value.field === 'string';
}
