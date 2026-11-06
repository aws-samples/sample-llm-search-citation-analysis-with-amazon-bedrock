import {
  useCallback, useEffect, useState
} from 'react';
import type { SelfReflectionResponse } from '../types';
import { isRecord } from '../types/domain/keywordDecoders';
import {
  fetchErrors, isAnalysisPayload, useAnalysisEndpoint
} from './useAnalysisEndpoint';

/** How often a running analysis is checked; the API's job runs 60 s at most. */
export const SELF_REFLECTION_POLL_INTERVAL_MS = 3000;
/** Checks before giving up on a running analysis (two minutes at the interval above). */
export const SELF_REFLECTION_MAX_POLLS = 40;
export const SELF_REFLECTION_GAVE_UP = 'The analysis is taking longer than expected; try again in a minute.';
export const SELF_REFLECTION_NO_RESULT = 'The analysis finished without a result; try again.';

/** `POST /self-reflection` answering 202: the model is being asked in the background. */
interface SelfReflectionPending {
  status: 'pending';
  keyword: string;
  brand: string;
  query_prompt_id: string;
}

interface SelfReflectionJob {
  status: 'pending' | 'failed';
  error?: string;
}

/** `GET /self-reflection` for one keyword, brand and persona: the stored reflections and the running job. */
interface SelfReflectionStatus {
  results: SelfReflectionResponse[];
  job: SelfReflectionJob | null;
}

function isSelfReflectionResponse(data: unknown): data is SelfReflectionResponse {
  if (!isAnalysisPayload(data)) return false;
  return 'keyword' in data && 'brand' in data && 'explanation' in data;
}

function isSelfReflectionPending(data: unknown): data is SelfReflectionPending {
  return isRecord(data)
    && data.status === 'pending'
    && typeof data.keyword === 'string'
    && typeof data.brand === 'string'
    && typeof data.query_prompt_id === 'string';
}

function isSelfReflectionJob(data: unknown): data is SelfReflectionJob {
  return isRecord(data) && (data.status === 'pending' || data.status === 'failed');
}

function isSelfReflectionStatus(data: unknown): data is SelfReflectionStatus {
  return isAnalysisPayload(data)
    && Array.isArray(data.results)
    && data.results.every(isSelfReflectionResponse)
    && (data.job === null || data.job === undefined || isSelfReflectionJob(data.job));
}

const SELF_REFLECTION_ERRORS = fetchErrors('SelfReflectionFetchError', 'Failed to fetch self-reflection data');

const reflectionTriggerEndpoint = {
  errorContext: 'self-reflection',
  logMessage: '[self-reflection] Error triggering reflection:',
  isValidResponse: (data: unknown): data is SelfReflectionResponse | SelfReflectionPending => (
    isSelfReflectionResponse(data) || isSelfReflectionPending(data)
  ),
  ...SELF_REFLECTION_ERRORS,
  buildRequest: (keyword: string, brand: string, queryPromptId: string, forceRefresh = false) => ({
    path: '/self-reflection',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword,
        brand,
        query_prompt_id: queryPromptId,
        force_refresh: forceRefresh,
      }),
    },
  }),
};

const reflectionStatusEndpoint = {
  errorContext: 'self-reflection',
  logMessage: '[self-reflection] Error checking the analysis:',
  isValidResponse: isSelfReflectionStatus,
  ...SELF_REFLECTION_ERRORS,
  buildRequest: (pending: SelfReflectionPending) => ({
    path: '/self-reflection',
    params: new URLSearchParams({
      keyword: pending.keyword,
      brand: pending.brand,
      query_prompt_id: pending.query_prompt_id,
    }),
  }),
};

/** The reflection a finished job left, or `null` while it runs or when it failed. */
function finishedReflection(status: SelfReflectionStatus | null): SelfReflectionResponse | null {
  if (status?.job !== null) return null;
  return status.results[0] ?? null;
}

/** Why polling ended without a reflection, or `null` while it may still bring one. */
function pollingError(status: SelfReflectionStatus | null, polls: number): string | null {
  if (status?.job?.status === 'failed') return status.job.error ?? SELF_REFLECTION_NO_RESULT;
  if (status !== null && status.job === null && status.results.length === 0) return SELF_REFLECTION_NO_RESULT;
  if (polls >= SELF_REFLECTION_MAX_POLLS && status?.job?.status === 'pending') return SELF_REFLECTION_GAVE_UP;
  return null;
}

/**
 * Asks why a brand ranks where it does for a keyword and persona.
 *
 * The POST answers at once when no model call is needed (a cached or
 * trivial answer); otherwise it answers 202 and the model is asked in the
 * background, so the hook checks `GET /self-reflection` every
 * `SELF_REFLECTION_POLL_INTERVAL_MS` until the job finishes or fails, at most
 * `SELF_REFLECTION_MAX_POLLS` times. `loading` stays true meanwhile; unmount
 * stops the checks.
 */
export function useSelfReflection() {
  const trigger = useAnalysisEndpoint(reflectionTriggerEndpoint);
  const poll = useAnalysisEndpoint(reflectionStatusEndpoint);
  const [polls, setPolls] = useState(0);
  const { fetchData: fetchTrigger } = trigger;
  const {
    fetchData: fetchStatus, reset: resetStatus 
  } = poll;

  const pending = isSelfReflectionPending(trigger.data) ? trigger.data : null;
  const result = isSelfReflectionResponse(trigger.data) ? trigger.data : finishedReflection(poll.data);
  const error = trigger.error ?? poll.error ?? (pending === null ? null : pollingError(poll.data, polls));
  const waiting = pending !== null && result === null && error === null;

  useEffect(() => {
    if (pending === null || !waiting || poll.loading) return undefined;
    const timer = setTimeout(() => {
      setPolls((count) => count + 1);
      void fetchStatus(pending);
    }, SELF_REFLECTION_POLL_INTERVAL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [pending, waiting, poll.loading, poll.data, fetchStatus]);

  const triggerReflection = useCallback((...args: Parameters<typeof reflectionTriggerEndpoint.buildRequest>) => {
    resetStatus();
    setPolls(0);
    return fetchTrigger(...args);
  }, [resetStatus, fetchTrigger]);

  return {
    data: result,
    loading: trigger.loading || waiting,
    error,
    triggerReflection,
  };
}
