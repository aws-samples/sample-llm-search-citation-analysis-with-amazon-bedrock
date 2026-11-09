/**
 * Waiting out a `202` view job (2.45.0, `lambda/shared/snapshot_artifacts.py`).
 *
 * A scoped GET whose answer no snapshot holds answers `202 {status:'computing', job, retry_after_ms}`
 * and starts a view job; the same GET answers `200` once the job stored its result. The client does
 * not repeat the GET on a timer (TENETS.md tenet 8): it listens to the deployment's `view-jobs`
 * channel and repeats it when that job's `view-job.finished` event arrives, and once when the
 * subscription becomes active (the job may have finished before it did) and after every reconnect.
 * One request runs at a time. It gives up after 3 minutes. A job that failed answers
 * `200 {status:'failed', message}` once; that becomes an error, and the next GET starts the job again.
 */
import {
  abortReason, ApiRequestError, authenticatedFetch
} from '../infrastructure';
import {
  deploymentChannel, eventField, waitForLive, type LiveEvent
} from '../infrastructure/liveEvents';
import {
  isComputingResponse, isFailedViewJobResponse
} from '../types/domain/scopeCoverageDecoders';
import type { ComputingResponse } from '../types/domain/scopeCoverage';

/** How long a view waits for a job's result before it says the figures are still being computed. */
export const VIEW_JOB_WAIT_LIMIT_MS = 180_000;

const VIEW_JOBS_CHANNEL = deploymentChannel('view-jobs');

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

/** Whether `event` says view job `jobId` finished (`view-job.finished`, `lambda/shared/change_events.py`). */
export function isViewJobFinished(event: LiveEvent, jobId: string): boolean {
  return event.type === 'view-job.finished' && eventField(event, 'job_id') === jobId;
}

/** The first answer that is not `202` computing: a failed job rejects, anything else is the body. */
function settledBody(answer: JsonAnswer): { readonly body: unknown } | ComputingResponse {
  const { body } = answer;
  if (isFailedViewJobResponse(body)) {
    throw new ApiRequestError(`The view job failed: ${body.message}`, { statusCode: 500 });
  }
  return answer.status === 202 && isComputingResponse(body) ? body : { body };
}

/**
 * Repeats `load` on the events of the job `computing` names (and on each activation of the subscription)
 * until it answers something other than `202` computing, at most `VIEW_JOB_WAIT_LIMIT_MS`. A `202` naming
 * another job (a new build) follows that job.
 */
function awaitFinishedJob(
  load: () => Promise<JsonAnswer>,
  computing: ComputingResponse,
  options: ViewJobWaitOptions,
): Promise<unknown> {
  const watched = { jobId: computing.job.id };
  return waitForLive<unknown>({
    channel: VIEW_JOBS_CHANNEL,
    matches: (event) => isViewJobFinished(event, watched.jobId),
    read: async () => {
      const settled = settledBody(await load());
      if ('body' in settled) return {
        settled: true,
        value: settled.body 
      };
      watched.jobId = settled.job.id;
      options.onComputing?.(settled);
      return { settled: false };
    },
    limitMs: VIEW_JOB_WAIT_LIMIT_MS,
    timedOut: viewJobTimeout,
    signal: options.signal,
  });
}

/**
 * Runs `load` and, while it answers `202` computing, waits for the job's `view-job.finished` event and runs it
 * again; returns the first other body. Throws an `ApiRequestError` (500) for a failed job and (504) when the job
 * has not finished after 3 minutes; an abort rejects at once with the signal's reason.
 */
export async function awaitViewJob(
  load: () => Promise<JsonAnswer>,
  options: ViewJobWaitOptions = {},
): Promise<unknown> {
  const settled = settledBody(await load());
  if ('body' in settled) return settled.body;
  options.onComputing?.(settled);
  return awaitFinishedJob(load, settled, options);
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
