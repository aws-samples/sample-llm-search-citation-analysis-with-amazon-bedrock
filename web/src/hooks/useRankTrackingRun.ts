import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  fetchLatestRankRun, startRankRun
} from '../api/seoRankTracking';
import { seoErrorMessage } from '../api/seo';
import type { RankRun } from '../types/api/seoRankTracking';
import { useSeoJobRefresh } from './useSeoJobRefresh';

export function isRunActive(run: RankRun | null): boolean {
  return run !== null && (run.status === 'pending' || run.status === 'running');
}

export interface RankRunControl {
  readonly run: RankRun | null;
  readonly starting: boolean;
  readonly error: string | null;
  /** Start a paid manual run; resolves once it is queued. */
  readonly start: () => Promise<void>;
}

/**
 * The tracker's latest run: while it is active, read again (free) whenever a step of one of the tracker's runs
 * ran and once on every (re)connect of the SEO channel (TENETS.md tenet 8), and `onFinished` called once when it
 * ends, so the caller re-reads the results. `start` is the only paid action and runs only when called.
 */
export function useRankTrackingRun(trackerId: string, initial: RankRun | null, onFinished: () => void): RankRunControl {
  const [run, setRun] = useState<RankRun | null>(initial);
  const [start, setStart] = useState<{
    starting: boolean;
    error: string | null 
  }>({
    starting: false,
    error: null 
  });
  const {
    starting, error 
  } = start;
  const setError = useCallback((message: string) => setStart({
    starting: false,
    error: message 
  }), []);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  useEffect(() => {
    setRun(initial);
  }, [initial]);

  const active = isRunActive(run);
  useSeoJobRefresh('rank', active ? trackerId : null, (tracker) => fetchLatestRankRun(tracker).then((latest) => {
    setRun(latest);
    if (!isRunActive(latest)) finishedRef.current();
  }, (failure: unknown) => setError(seoErrorMessage(failure))));

  const begin = useCallback(() => {
    setStart({
      starting: true,
      error: null 
    });
    return startRankRun(trackerId).then((started) => {
      setRun(started.run);
      setStart({
        starting: false,
        error: null 
      });
    }, (failure: unknown) => setError(seoErrorMessage(failure)));
  }, [trackerId, setError]);

  return {
    run,
    starting,
    error,
    start: begin,
  };
}
