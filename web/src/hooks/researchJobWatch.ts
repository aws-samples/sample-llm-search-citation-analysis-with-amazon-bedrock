import { ApiRequestError } from '../infrastructure';
import { fetchKeywordResearch } from '../api/keywordResearch';
import {
  deploymentChannel, eventField, waitForLive, type LiveEvent
} from '../infrastructure/liveEvents';
import { isActiveResearchStatus } from '../formatting/researchStatus';
import type { KeywordResearchItem } from '../types';

class KeywordResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordResearchError';
  }
}

/**
 * How long a research job is waited for: past the state machine's 30-minute timeout, so the client only gives up
 * after the server necessarily has (its timeout is announced too, and the read then reports the job failed).
 */
export const RESEARCH_WAIT_LIMIT_MS = 36 * 60_000;

const RESEARCH_CHANNEL = deploymentChannel('research');

export interface ResearchWatchOptions {
  jobId: string;
  /** Aborted when a newer call or an unmount supersedes this wait; it then resolves `null`. */
  signal: AbortSignal;
  /** Called with every non-terminal read so the UI can render progress. */
  onProgress: (job: KeywordResearchItem) => void;
  timeoutMessage: string;
}

/**
 * Whether `event` concerns research job `jobId`: a worker step changed it (`research-job.changed`), or its
 * execution changed status (a Step Functions status change names the job from its input).
 */
export function concernsResearchJob(event: LiveEvent, jobId: string): boolean {
  return eventField(event, 'job_id') === jobId;
}

/**
 * One read of the job. Returns null on transient errors (keep waiting) and
 * throws when waiting any longer cannot help: the session expired, or the job
 * is gone. Without the auth check an expired session kept waiting for the
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
 * Waits for research job `jobId` to reach a terminal status (TENETS.md tenet 8): `GET /keyword-research/{id}` is
 * read once when the research channel connects (and after every reconnect) and again whenever the job changed,
 * never on a timer.
 *
 * Resolves with the terminal job, or null when `signal` aborted (a newer call or an unmount). Throws
 * `KeywordResearchError` on auth failure, a deleted job, or after `RESEARCH_WAIT_LIMIT_MS` without an end.
 */
export function watchResearchJob(options: ResearchWatchOptions): Promise<KeywordResearchItem | null> {
  return waitForLive<KeywordResearchItem | null>({
    channel: RESEARCH_CHANNEL,
    matches: (event) => concernsResearchJob(event, options.jobId),
    read: async () => {
      const job = await readJob(options.jobId);
      if (job !== null && !isActiveResearchStatus(job.status)) return {
        settled: true,
        value: job 
      };
      if (job !== null && !options.signal.aborted) options.onProgress(job);
      return { settled: false };
    },
    limitMs: RESEARCH_WAIT_LIMIT_MS,
    timedOut: () => new KeywordResearchError(options.timeoutMessage),
    signal: options.signal,
    abortedValue: () => null,
  });
}
