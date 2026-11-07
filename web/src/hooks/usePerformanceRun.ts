import {
  useCallback, useEffect, useRef, useState
} from 'react';
import { seoErrorMessage } from '../api/seo';
import { fetchLighthouseRun } from '../api/seoPerformance';
import type {
  LighthouseRun, StartRunResponse
} from '../types/api/seoPerformance';

export const RUN_POLL_INTERVAL_MS = 5000;

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
 * One Lighthouse run on screen: started on a click (or opened from the list), then read every 5 s while it
 * runs. The polling reads are free; an unmount, a newer start or a newer open stops them.
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

  useEffect(() => {
    if (state.status !== 'running') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchLighthouseRun(state.run.run_id, { signal: controller.signal })
        .then((run) => { if (!controller.signal.aborted) setState(shown(run, state.reused)); })
        .catch((failure: unknown) => { if (!controller.signal.aborted) setState(failed(failure)); });
    }, RUN_POLL_INTERVAL_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state]);

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
