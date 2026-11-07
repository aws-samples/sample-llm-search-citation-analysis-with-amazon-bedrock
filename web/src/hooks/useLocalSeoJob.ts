import {
  useCallback, useEffect, useRef, useState
} from 'react';
import { seoErrorMessage } from '../api/seo';
import {
  fetchLocalJob, startLocalJob
} from '../api/seoLocal';
import type {
  LocalJob, LocalJobRequest
} from '../types/api/seoLocal';

export const JOB_POLL_INTERVAL_MS = 5000;
const TERMINAL: readonly LocalJob['status'][] = ['completed', 'failed', 'timed_out'];

export type LocalJobState =
  | { readonly status: 'idle' }
  | { readonly status: 'starting' }
  | {
    readonly status: 'running' | 'done';
    readonly job: LocalJob;
    readonly reused: boolean 
  }
  | {
    readonly status: 'error';
    readonly message: string 
  };

export interface LocalJobController {
  readonly state: LocalJobState;
  /** Starts the (paid) job once; an equal request within the hour reuses the bought tasks. */
  readonly start: (request: LocalJobRequest) => Promise<void>;
  readonly reset: () => void;
}

function isTerminal(job: LocalJob): boolean {
  return TERMINAL.includes(job.status);
}

/**
 * A queued local SEO job: one paid `POST /seo/local/jobs` on the user's click, then the free status route
 * every 5 s until the job completes, fails or times out. An unmount or reset stops the polling.
 */
export function useLocalSeoJob(): LocalJobController {
  const [state, setState] = useState<LocalJobState>({ status: 'idle' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current += 1;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  /** Shows `failure` unless a newer start or a reset superseded the call it came from. */
  const fail = useCallback((generation: number, failure: unknown) => {
    if (generationRef.current !== generation) return;
    console.error('[seo] Local job failed:', failure);
    setState({
      status: 'error',
      message: seoErrorMessage(failure) 
    });
  }, []);

  const show = useCallback((job: LocalJob, reused: boolean, generation: number) => {
    if (generationRef.current !== generation) return;
    setState({
      status: isTerminal(job) ? 'done' : 'running',
      job,
      reused 
    });
    if (isTerminal(job)) return;
    timerRef.current = setTimeout(() => {
      fetchLocalJob(job.job_id)
        .then((next) => { show(next, reused, generation); })
        .catch((failure: unknown) => { fail(generation, failure); });
    }, JOB_POLL_INTERVAL_MS);
  }, [fail]);

  const start = useCallback(async (request: LocalJobRequest) => {
    stop();
    const generation = generationRef.current;
    setState({ status: 'starting' });
    try {
      const response = await startLocalJob(request);
      show(response.job, response.reused, generation);
    } catch (failure) {
      fail(generation, failure);
    }
  }, [fail, show, stop]);

  const reset = useCallback(() => {
    stop();
    setState({ status: 'idle' });
  }, [stop]);

  return {
    state,
    start,
    reset 
  };
}
