import {
  useCallback, useEffect, useState
} from 'react';
import {
  deploymentChannel, eventField, type LiveEvent
} from '../infrastructure/liveEvents';
import type { SelfReflectionResponse } from '../types';
import { isRecord } from '../types/domain/keywordDecoders';
import {
  fetchErrors, isAnalysisPayload, useAnalysisEndpoint
} from './useAnalysisEndpoint';
import { useLiveRefresh } from './useLiveRefresh';

/** How long a running analysis is waited for before giving up; the API's job runs 60 s at most. */
export const SELF_REFLECTION_WAIT_LIMIT_MS = 120_000;

const INSIGHTS_CHANNEL = deploymentChannel('insights');
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

/** Why the wait ended without a reflection, or `null` while it may still bring one. */
function waitingError(status: SelfReflectionStatus | null, gaveUp: boolean): string | null {
  if (status?.job?.status === 'failed') return status.job.error ?? SELF_REFLECTION_NO_RESULT;
  if (status !== null && status.job === null && status.results.length === 0) return SELF_REFLECTION_NO_RESULT;
  if (gaveUp) return SELF_REFLECTION_GAVE_UP;
  return null;
}

/**
 * Whether `event` says the analysis `pending` waits for finished (`self-reflection.finished`,
 * `lambda/api/self-reflection.py`): same keyword, brand and persona.
 */
export function isReflectionFinished(event: LiveEvent, pending: SelfReflectionPending): boolean {
  return event.type === 'self-reflection.finished'
    && eventField(event, 'keyword') === pending.keyword
    && eventField(event, 'brand') === pending.brand
    && eventField(event, 'query_prompt_id') === pending.query_prompt_id;
}

/**
 * Asks why a brand ranks where it does for a keyword and persona.
 *
 * The POST answers at once when no model call is needed (a cached or
 * trivial answer); otherwise it answers 202 and the model is asked in the
 * background, so the hook listens to the insights channel and reads
 * `GET /self-reflection` once when the subscription becomes active (and
 * after every reconnect) and again when the job's `self-reflection.finished`
 * event arrives (TENETS.md tenet 8). It gives up after
 * `SELF_REFLECTION_WAIT_LIMIT_MS`. `loading` stays true meanwhile; unmount
 * stops listening.
 */
export function useSelfReflection() {
  const trigger = useAnalysisEndpoint(reflectionTriggerEndpoint);
  const status = useAnalysisEndpoint(reflectionStatusEndpoint);
  const [gaveUp, setGaveUp] = useState(false);
  const { fetchData: fetchTrigger } = trigger;
  const {
    fetchData: fetchStatus, reset: resetStatus 
  } = status;

  const pending = isSelfReflectionPending(trigger.data) ? trigger.data : null;
  const result = isSelfReflectionResponse(trigger.data) ? trigger.data : finishedReflection(status.data);
  const error = trigger.error ?? status.error ?? (pending === null ? null : waitingError(status.data, gaveUp));
  const waiting = pending !== null && result === null && error === null;

  useLiveRefresh(
    waiting ? INSIGHTS_CHANNEL : null,
    () => (pending === null ? Promise.resolve() : fetchStatus(pending)),
    (event) => pending !== null && isReflectionFinished(event, pending)
  );

  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => setGaveUp(true), SELF_REFLECTION_WAIT_LIMIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [waiting]);

  const triggerReflection = useCallback((...args: Parameters<typeof reflectionTriggerEndpoint.buildRequest>) => {
    resetStatus();
    setGaveUp(false);
    return fetchTrigger(...args);
  }, [resetStatus, fetchTrigger]);

  return {
    data: result,
    loading: trigger.loading || waiting,
    error,
    triggerReflection,
  };
}
