import {
  useCallback, useRef, useState
} from 'react';
import { seoErrorMessage } from '../api/seo';
import { fetchLighthouseRun } from '../api/seoPerformance';
import {
  deploymentChannel, eventField, type LiveEvent
} from '../infrastructure/liveEvents';
import type {
  LighthouseRun, StartRunResponse
} from '../types/api/seoPerformance';
import { useLiveRefresh } from './useLiveRefresh';

const SEO_CHANNEL = deploymentChannel('seo');

/** Whether `event` says a step of Lighthouse run `runId` ran (`seo-job.changed`, `lambda/seo-jobs/seo-jobs.py`). */
export function isLighthouseRunEvent(event: LiveEvent, runId: string): boolean {
  return eventField(event, 'feature') === 'lighthouse' && eventField(event, 'id') === runId;
}

/** Nothing shown yet, a start or open under way, a run on screen, or why it could not be shown. */
export type RunState =
  | {
    readonly status: 'error';
    readonly message: string;
  }
  | {
    readonly status: 'running' | 'done';
    readonly run: LighthouseRun;
    /** The run an equal request already started within 15 minutes (nothing new was bought). */
    readonly reused: boolean;
  }
  | { readonly status: 'starting' }
  | { readonly status: 'idle' };

export interface RunController {
  readonly state: RunState;
  /** Calls `starter` once (a paid start); never retried. */
  readonly start: (starter: () => Promise<StartRunResponse>) => Promise<void>;
  /** Shows a run from the recent list (free). */
  readonly open: (runId: string) => Promise<void>;
}

function shown(run: LighthouseRun, reused: boolean): RunState {
  const finished = run.status === 'completed' || run.status === 'failed';
  return {
    status: finished ? 'done' : 'running',
    run,
    reused
  };
}

function failed(failure: unknown): RunState {
  console.error('[seo] Lighthouse run failed:', failure);
  return {
    status: 'error',
    message: seoErrorMessage(failure)
  };
}

/**
 * One Lighthouse run on screen: started on a click (or opened from the list); while it runs, it is read again
 * (free) once when the SEO channel connects or reconnects and whenever a step of it ran (TENETS.md tenet 8). An
 * unmount, a newer start or a newer open stops listening to it.
 */
export function usePerformanceRun(): RunController {
  const [state, setState] = useState<RunState>({ status: 'idle' });
  const latest = useRef(0);

  const show = useCallback(async (load: () => Promise<StartRunResponse>) => {
    latest.current += 1;
    const ticket = latest.current;
    setState({ status: 'starting' });
    try {
      const answer = await load();
      if (latest.current === ticket) setState(shown(answer.run, answer.reused));
    } catch (failure) {
      if (latest.current === ticket) setState(failed(failure));
    }
  }, []);

  const running = state.status === 'running' ? state : null;
  useLiveRefresh(
    running === null ? null : SEO_CHANNEL,
    async () => {
      if (running === null) return;
      const ticket = latest.current;
      try {
        const run = await fetchLighthouseRun(running.run.run_id);
        if (latest.current === ticket) setState(shown(run, running.reused));
      } catch (failure) {
        if (latest.current === ticket) setState(failed(failure));
      }
    },
    (event) => running !== null && isLighthouseRunEvent(event, running.run.run_id)
  );

  const open = useCallback((runId: string) => show(async () => ({
    run: await fetchLighthouseRun(runId),
    reused: false
  })), [show]);

  return {
    state,
    start: show,
    open
  };
}
