import {
  useCallback, useEffect, useRef, useState
} from 'react';
import { seoErrorMessage } from '../api/seo';
import {
  fetchLocalJob, startLocalJob
} from '../api/seoLocal';
import {
  deploymentChannel, eventField, type LiveEvent
} from '../infrastructure/liveEvents';
import type {
  LocalJob, LocalJobRequest
} from '../types/api/seoLocal';
import { useLiveRefresh } from './useLiveRefresh';

const TERMINAL: readonly LocalJob['status'][] = ['completed', 'failed', 'timed_out'];
const SEO_CHANNEL = deploymentChannel('seo');

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

/** Whether `event` says a step of local SEO job `jobId` ran (`seo-job.changed`, `lambda/seo-jobs/seo-jobs.py`). */
export function isLocalJobEvent(event: LiveEvent, jobId: string): boolean {
  return eventField(event, 'feature') === 'local' && eventField(event, 'id') === jobId;
}

/**
 * A queued local SEO job: one paid `POST /seo/local/jobs` on the user's click; then, while it runs, the free
 * status route is read once when the SEO channel connects (and reconnects) and again whenever a step of this job
 * ran (TENETS.md tenet 8), until the job completes, fails or times out. An unmount or reset stops listening.
 */
export function useLocalSeoJob(): LocalJobController {
  const [state, setState] = useState<LocalJobState>({ status: 'idle' });
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current += 1;
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
  }, []);

  const running = state.status === 'running' ? state : null;
  useLiveRefresh(
    running === null ? null : SEO_CHANNEL,
    async () => {
      if (running === null) return;
      const generation = generationRef.current;
      try {
        show(await fetchLocalJob(running.job.job_id), running.reused, generation);
      } catch (failure) {
        fail(generation, failure);
      }
    },
    (event) => running !== null && isLocalJobEvent(event, running.job.job_id)
  );

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
