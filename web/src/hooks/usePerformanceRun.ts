import {
  useCallback, useRef, useState
} from 'react';
import { seoErrorMessage } from '../api/seo';
import { fetchLighthouseRun } from '../api/seoPerformance';
import type {
  LighthouseRun, StartRunResponse
} from '../types/api/seoPerformance';
import { useSeoJobRefresh } from './useSeoJobRefresh';

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

  /** Shows what `load` answers unless a newer start or open took over since `ticket` was drawn. */
  const settle = useCallback(async (ticket: number, load: () => Promise<StartRunResponse>) => {
    try {
      const answer = await load();
      if (latest.current === ticket) setState(shown(answer.run, answer.reused));
    } catch (failure) {
      if (latest.current === ticket) setState(failed(failure));
    }
  }, []);

  const show = useCallback(async (load: () => Promise<StartRunResponse>) => {
    latest.current += 1;
    setState({ status: 'starting' });
    await settle(latest.current, load);
  }, [settle]);

  useSeoJobRefresh('lighthouse', state.status === 'running' ? state.run.run_id : null, (runId) => settle(
    latest.current,
    async () => ({
      run: await fetchLighthouseRun(runId),
      reused: state.status === 'running' && state.reused
    })
  ));

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
