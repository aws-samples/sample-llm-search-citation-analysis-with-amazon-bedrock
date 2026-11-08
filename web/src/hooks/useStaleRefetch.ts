import {
  useCallback, useEffect, useRef
} from 'react';
import { isRecord } from '../types/domain/keywordDecoders';

/**
 * A scoped answer served from a snapshot older than the scope (`stale: true`, 2.45.0) is shown
 * as it is while a rebuild runs; the view asks again every 10 s until the answer is current,
 * at most 18 times (3 minutes), then keeps the figures it has.
 */
export const STALE_REFETCH_INTERVAL_MS = 10_000;
export const STALE_REFETCH_LIMIT = 18;

/** A scoped body whose snapshot predates the scope's latest change. */
export function isStaleScopedBody(value: unknown): boolean {
  return isRecord(value) && value.stale === true;
}

/**
 * One pending refetch timer: `schedule` replaces it, `cancel` drops it, and unmount clears it.
 * The caller counts the rounds and stops at `STALE_REFETCH_LIMIT`.
 */
export function useStaleRefetch() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback((): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = useCallback((refetch: () => void): void => {
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      refetch();
    }, STALE_REFETCH_INTERVAL_MS);
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  return {
    schedule,
    cancel,
  };
}
