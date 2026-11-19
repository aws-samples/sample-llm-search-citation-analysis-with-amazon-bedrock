/**
 * Re-extract stored answers (2.55.0, Admin only): estimate, start and stop the job that runs the brand extraction
 * again on stored AI answers, and read the newest job. One job runs at a time per deployment.
 */
import { ApiRequestError } from '../infrastructure';
import { isRecord } from '../types/domain/keywordDecoders';
import {
  apiGet, apiPost
} from './client';
import {
  isReextractEstimate, isReextractJobEnvelope, isReextractStatus,
  type ReextractEstimate, type ReextractFilters, type ReextractJob, type ReextractStatus
} from './reextractDecoders';

/** What `POST /api/reextract` did: started the job, or refused because one is already running (409). */
export type ReextractStart =
  | {
    readonly kind: 'started';
    readonly job: ReextractJob;
  }
  | {
    readonly kind: 'already-running';
    readonly job: ReextractJob;
    readonly message: string;
  };

function decodeJob(payload: unknown): ReextractJob {
  if (!isReextractJobEnvelope(payload)) throw new ApiRequestError('The re-extract answer is not a job');
  return payload.job;
}

/** `POST /api/reextract/estimate`: how many answers the filters select, and their Bedrock cost. */
export async function estimateReextract(filters: ReextractFilters): Promise<ReextractEstimate> {
  const answer = await apiPost<unknown>('/reextract/estimate', filters, { allowStructured4xx: true });
  if (!isReextractEstimate(answer)) throw new ApiRequestError('The re-extract estimate is malformed');
  return answer;
}

/** `POST /api/reextract`: starts the job (202), or names the job already running (409). */
export async function startReextract(filters: ReextractFilters): Promise<ReextractStart> {
  const payload = await apiPost<unknown>('/reextract', filters, {
    allowStructured4xx: true,
    acceptedJsonStatuses: [409],
  });
  const job = decodeJob(payload);
  if (isRecord(payload) && typeof payload.error === 'string') {
    return {
      kind: 'already-running',
      job,
      message: payload.error,
    };
  }
  return {
    kind: 'started',
    job,
  };
}

/** `GET /api/reextract`: the newest job (or none) and whether one is active. */
export async function getReextractStatus(signal?: AbortSignal): Promise<ReextractStatus> {
  const answer = await apiGet<unknown>('/reextract', {
    signal,
    retry: false,
  });
  if (!isReextractStatus(answer)) throw new ApiRequestError('The re-extract status is malformed');
  return answer;
}

/** `POST /api/reextract/{id}/stop`: asks the job to stop; it reads `stopping`, then `stopped`. */
export async function stopReextract(jobId: string): Promise<ReextractJob> {
  return decodeJob(await apiPost<unknown>(`/reextract/${encodeURIComponent(jobId)}/stop`, {}, { allowStructured4xx: true }));
}
