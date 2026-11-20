import {
  useCallback, useState
} from 'react';
import {
  estimateReextract, getReextractStatus, startReextract, stopReextract
} from '../api/reextract';
import type {
  ReextractEstimate, ReextractFilters, ReextractJob, ReextractStatus
} from '../api/reextractDecoders';
import { getErrorMessage } from '../infrastructure';
import { deploymentChannel } from '../infrastructure/liveEvents';
import { useLiveRefresh } from './useLiveRefresh';

const REEXTRACT_CHANNEL = deploymentChannel('reextract');

const ACTIVE_STATUSES: ReadonlySet<ReextractJob['status']> = new Set(['running', 'stopping']);

/** The job is still working through answers (or finishing the step it is on before it stops). */
export function isReextractActive(job: ReextractJob | null): boolean {
  return job !== null && ACTIVE_STATUSES.has(job.status);
}

/** An estimate with the filters it was asked for, so the view can tell whether it still matches the form. */
export interface EstimateForFilters {
  readonly filters: ReextractFilters;
  readonly result: ReextractEstimate;
}

type Busy = 'estimating' | 'starting' | 'stopping' | null;

export interface UseReextractReturn {
  readonly status: ReextractStatus | null;
  readonly estimate: EstimateForFilters | null;
  readonly busy: Busy;
  readonly error: string | null;
  readonly runEstimate: (filters: ReextractFilters) => Promise<void>;
  readonly start: (filters: ReextractFilters) => Promise<void>;
  readonly stop: (jobId: string) => Promise<void>;
}

function withJob(job: ReextractJob): ReextractStatus {
  return {
    job,
    active: isReextractActive(job),
  };
}

/**
 * The re-extract job of the deployment (Admin only): reads `GET /api/reextract` when the live `reextract` channel
 * connects and again on each of its events (TENETS.md tenet 8, no polling), and runs the estimate, start and stop.
 * Mount it only for Admins: every route behind it answers 403 to anyone else.
 */
export function useReextract(): UseReextractReturn {
  const [status, setStatus] = useState<ReextractStatus | null>(null);
  const [estimate, setEstimate] = useState<EstimateForFilters | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      setStatus(await getReextractStatus());
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }, []);

  useLiveRefresh(REEXTRACT_CHANNEL, read);

  const perform = useCallback(async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(getErrorMessage(failure));
    } finally {
      setBusy(null);
    }
  }, []);

  const runEstimate = useCallback((filters: ReextractFilters) => perform('estimating', async () => {
    setEstimate({
      filters,
      result: await estimateReextract(filters),
    });
  }), [perform]);

  const start = useCallback((filters: ReextractFilters) => perform('starting', async () => {
    const outcome = await startReextract(filters);
    setStatus(withJob(outcome.job));
    if (outcome.kind === 'already-running') setError(outcome.message);
  }), [perform]);

  const stop = useCallback((jobId: string) => perform('stopping', async () => {
    setStatus(withJob(await stopReextract(jobId)));
  }), [perform]);

  return {
    status,
    estimate,
    busy,
    error,
    runEstimate,
    start,
    stop,
  };
}
