/**
 * Waiting out a `202` view job (2.45.0, `lambda/shared/snapshot_artifacts.py`).
 *
 * A scoped GET whose answer no snapshot holds answers `202 {status:'computing', job, retry_after_ms}`
 * and starts a view job; the same GET answers `200` once the job stored its result. The client
 * repeats the GET with a growing wait (2 s, 4 s, 8 s, then every 10 s, never sooner than the
 * server's `retry_after_ms`), one request at a time, and gives up after 3 minutes. A job that
 * failed answers `200 {status:'failed', message}` once; that becomes an error, and the next GET
 * starts the job again.
 */
import {
  ApiRequestError, authenticatedFetch
} from '../infrastructure';
import {
  isComputingResponse, isFailedViewJobResponse
} from '../types/domain/scopeCoverageDecoders';
import type { ComputingResponse } from '../types/domain/scopeCoverage';

export const COMPUTING_POLL_INITIAL_MS = 2_000;
export const COMPUTING_POLL_MAX_MS = 10_000;
export const COMPUTING_POLL_LIMIT_MS = 180_000;

/** One answer of the repeated GET: its status and decoded JSON body. */
export interface JsonAnswer {
  status: number;
  body: unknown;
}

export interface ViewJobWaitOptions {
  signal?: AbortSignal;
  /** Called on every `202`, so a view can show that the figures are being computed. */
  onComputing?: (computing: ComputingResponse) => void;
}

/**
 * The status and decoded JSON body of `response` (`response.json()` resolves `unknown` under
 * strict mode); a `204 No Content` has no body, so it reads as `null`.
 */
export async function jsonAnswer(response: Response): Promise<JsonAnswer> {
  const body: unknown = response.status === 204 ? null : await response.json();
  return {
    status: response.status,
    body,
  };
}

/** The wait before poll `attempt` (0-based): doubling from 2 s, capped at 10 s, at least the server's hint. */
export function computingPollDelayMs(attempt: number, retryAfterMs: number): number {
  const backoff = COMPUTING_POLL_INITIAL_MS * 2 ** Math.min(attempt, 8);
  return Math.min(COMPUTING_POLL_MAX_MS, Math.max(retryAfterMs, backoff));
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** Resolves after `ms`, or rejects with the signal's reason as soon as it aborts. */
export function abortableWait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      if (signal !== undefined) reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function viewJobTimeout(): ApiRequestError {
  return new ApiRequestError('The complete figures are still being computed; try again in a few minutes.', { statusCode: 504 });
}

async function pollViewJob(
  load: () => Promise<JsonAnswer>,
  options: ViewJobWaitOptions,
  startedAt: number,
  attempt: number,
): Promise<unknown> {
  const answer = await load();
  const { body } = answer;
  if (isFailedViewJobResponse(body)) {
    throw new ApiRequestError(`The view job failed: ${body.message}`, { statusCode: 500 });
  }
  if (answer.status !== 202 || !isComputingResponse(body)) return body;
  options.onComputing?.(body);
  const delay = computingPollDelayMs(attempt, body.retry_after_ms);
  if (Date.now() - startedAt + delay > COMPUTING_POLL_LIMIT_MS) throw viewJobTimeout();
  await abortableWait(delay, options.signal);
  return pollViewJob(load, options, startedAt, attempt + 1);
}

/**
 * Repeats `load` while it answers `202` computing and returns the first other body. Throws an
 * `ApiRequestError` (500) for a failed job and (504) when the job is still running after 3 minutes;
 * an abort rejects at once with the signal's reason.
 */
export function awaitViewJob(
  load: () => Promise<JsonAnswer>,
  options: ViewJobWaitOptions = {},
): Promise<unknown> {
  return pollViewJob(load, options, Date.now(), 0);
}

/**
 * One authenticated request of `url` (`init`: method, body), repeated while it answers `202`
 * computing (`awaitViewJob`). A non-OK status throws `httpError(status)`; the body is returned undecoded.
 */
export function fetchUntilReady(
  url: string,
  init: RequestInit,
  httpError: (status: number) => Error,
  options: ViewJobWaitOptions = {},
): Promise<unknown> {
  const abortable: RequestInit = {
    ...init,
    signal: options.signal,
  };
  return awaitViewJob(async () => {
    const response = await authenticatedFetch(url, abortable);
    if (!response.ok) throw httpError(response.status);
    return jsonAnswer(response);
  }, options);
}
