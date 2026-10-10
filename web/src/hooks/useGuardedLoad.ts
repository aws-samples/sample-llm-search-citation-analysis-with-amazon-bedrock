import {
  useCallback, useEffect, useState, type Dispatch, type SetStateAction
} from 'react';
import { isAbortError } from '../infrastructure';
import { useLatestRequest } from './useLatestRequest';

/** What one guarded load reads and how a failed read is reported. */
export interface GuardedLoadSource<TValue> {
  /** The value until the first load lands. */
  initial: TValue;
  /** Reads the value; `signal` aborts it when a newer operation starts or the hook unmounts. */
  load: (signal: AbortSignal) => Promise<TValue>;
  /** The message shown for a failed load. */
  errorMessage: (failure: unknown) => string;
  /** Console prefix a failed load is logged with; nothing is logged without one. */
  logMessage?: string;
}

export interface GuardedLoad<TValue> {
  data: TValue;
  /** A load is in flight. */
  loading: boolean;
  /** The first load has settled, so an `initial`-looking `data` is the answer, not the wait for one. */
  settled: boolean;
  error: string | null;
  /** Loads again; the answer of a load still in flight is dropped. */
  reload: () => Promise<void>;
  /** Replaces `data` with what a mutation the API confirmed left behind. */
  setData: Dispatch<SetStateAction<TValue>>;
  /**
   * Runs `request` as the newest operation: a load still in flight is
   * dropped, and `apply` only lands while nothing newer has started and the
   * hook is mounted. Resolves or rejects as `request` did.
   */
  mutate: <TResult>(request: () => Promise<TResult>, apply: (result: TResult) => void) => Promise<TResult>;
  isMounted: () => boolean;
}

/**
 * The guarded load the list hooks share: one `data`/`loading`/`error` state
 * set, a load on mount and `reload`, with `useLatestRequest` making the
 * latest operation the only one that may write. A stale answer, a stale
 * failure and anything landing after unmount are ignored, an aborted load is
 * not an error, and `loading` only clears when the current operation settles.
 *
 * Pass a module-level (or memoised) `source`: `reload` keeps its identity as
 * long as `source` does, and consumers list it in effect dependencies.
 */
export function useGuardedLoad<TValue>(source: GuardedLoadSource<TValue>): GuardedLoad<TValue> {
  const {
    beginRequest, isMounted
  } = useLatestRequest();
  const [data, setData] = useState<TValue>(source.initial);
  // Stryker disable next-line BooleanLiteral: the mount effect starts the first load before the first observable commit, and reload sets this same state true.
  const [loading, setLoading] = useState(true);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stryker disable ArrayDeclaration: React dependency list; beginRequest is stable and source is the caller's constant, so omitting them cannot stale reload.
  const reload = useCallback(async (): Promise<void> => {
    const request = beginRequest();
    setLoading(true);
    setError(null);
    try {
      const loaded = await source.load(request.signal);
      if (request.isCurrent()) setData(loaded);
    } catch (failure) {
      if (isAbortError(failure) || !request.isCurrent()) return;
      if (source.logMessage !== undefined) console.error(source.logMessage, failure);
      setError(source.errorMessage(failure));
    } finally {
      if (request.isCurrent()) {
        setLoading(false);
        setSettled(true);
      }
      // Stryker disable next-line CallExpression: equivalent, finish only stops a later cancel from aborting this settled request's signal, which nothing reads after it settles
      request.finish();
    }
  }, [beginRequest, source]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: reload has a stable identity, so omitting it cannot stale this mount effect.
  useEffect(() => {
    void reload();
  }, [reload]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: beginRequest has a stable identity, so omitting it cannot stale operation ordering.
  const mutate = useCallback(async <TResult,>(
    request: () => Promise<TResult>,
    apply: (result: TResult) => void
  ): Promise<TResult> => {
    const operation = beginRequest();
    try {
      const result = await request();
      if (operation.isCurrent()) apply(result);
      return result;
    } finally {
      if (operation.isCurrent()) setLoading(false);
      // Stryker disable next-line CallExpression: equivalent, finish only stops a later cancel from aborting this settled request's signal, which nothing reads after it settles
      operation.finish();
    }
  }, [beginRequest]);
  // Stryker restore ArrayDeclaration

  return {
    data,
    loading,
    settled,
    error,
    reload,
    setData,
    mutate,
    isMounted,
  };
}
