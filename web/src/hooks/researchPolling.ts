import { ApiRequestError } from '../infrastructure';
import { fetchKeywordResearch } from '../api/keywordResearch';
import { isActiveResearchStatus } from '../formatting/researchStatus';
import type { KeywordResearchItem } from '../types';

export class KeywordResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordResearchError';
  }
}

/**
 * Polling schedule for a research job: every 3s for the first minute, then
 * every 10s. The window outlasts the state machine's 30-minute timeout, so
 * the client only gives up after the server necessarily has.
 */
export const POLL_FAST_INTERVAL_MS = 3000;
export const POLL_SLOW_INTERVAL_MS = 10_000;
export const POLL_FAST_ATTEMPTS = 20;
export const POLL_MAX_ATTEMPTS = 230;

export interface ResearchPollOptions {
  jobId: string;
  /** True once a newer call or an unmount superseded this poll. */
  isCancelled: () => boolean;
  /** Called with every non-terminal snapshot so the UI can render progress. */
  onProgress: (job: KeywordResearchItem) => void;
  timeoutMessage: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function pollInterval(attempt: number): number {
  return attempt < POLL_FAST_ATTEMPTS ? POLL_FAST_INTERVAL_MS : POLL_SLOW_INTERVAL_MS;
}

/**
 * One read of the job. Returns null on transient errors (keep polling) and
 * throws when waiting any longer cannot help: the session expired, or the job
 * is gone. Without the auth check an expired session kept polling for the
 * whole window and then reported a bogus timeout (AUDIT 2.20).
 */
async function readJob(jobId: string): Promise<KeywordResearchItem | null> {
  try {
    return await fetchKeywordResearch(jobId);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.statusCode === 401 || error.statusCode === 403)) {
      // Worded to categorize as 'auth' in getErrorMessage.
      throw new KeywordResearchError(
        `Unauthorized (${error.statusCode}): session expired while waiting for results. Sign in again, then check History.`
      );
    }
    if (error instanceof ApiRequestError && error.statusCode === 404) {
      throw new KeywordResearchError('Research job not found. It may have been deleted.');
    }
    return null;
  }
}

/**
 * Poll `GET /keyword-research/{id}` until the job reaches a terminal status.
 *
 * Resolves with the terminal job, or null when the poll was cancelled (a
 * newer call or an unmount). Throws `KeywordResearchError` on auth failure,
 * a deleted job, or when the window is exhausted.
 */
export async function pollResearchJob(
  options: ResearchPollOptions,
  attempt = 0
): Promise<KeywordResearchItem | null> {
  if (attempt >= POLL_MAX_ATTEMPTS) {
    throw new KeywordResearchError(options.timeoutMessage);
  }
  await sleep(pollInterval(attempt));
  if (options.isCancelled()) return null;
  const job = await readJob(options.jobId);
  if (options.isCancelled()) return null;
  if (job && !isActiveResearchStatus(job.status)) return job;
  if (job) options.onProgress(job);
  return pollResearchJob(options, attempt + 1);
}
