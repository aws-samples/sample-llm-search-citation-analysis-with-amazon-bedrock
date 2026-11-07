import { isAbortError } from '../infrastructure';
import { seoErrorMessage } from '../api/seo';
import {
  useCallback, useEffect, useRef, useState
} from 'react';

/** A free site-audit read: loading (first load only), answered, or failed with the message to show. */
export type SiteAuditLoadState<T> =
  | { readonly status: 'loading' }
  | {
    readonly status: 'success';
    readonly value: T;
  }
  | {
    readonly status: 'error';
    readonly message: string;
  };

export interface SiteAuditLoad<T> {
  readonly state: SiteAuditLoadState<T>;
  /** Read again; the current answer stays on screen until the new one arrives. */
  readonly reload: () => void;
}

const LOADING = { status: 'loading' } satisfies SiteAuditLoadState<never>;

interface KeyedState<T> {
  readonly key: string | null;
  readonly state: SiteAuditLoadState<T>;
}

/**
 * Loads `load` when `key` is set and again whenever it changes or `reload` is
 * called. Only the latest call's answer is kept, an answer for another key is
 * never shown, and an unmount aborts the call in flight. The audit reads are
 * free (no paid API), so loading on mount is fine.
 */
export function useSiteAuditLoad<T>(
  key: string | null, load: (signal: AbortSignal) => Promise<T>
): SiteAuditLoad<T> {
  const [keyed, setKeyed] = useState<KeyedState<T>>({
    key: null,
    state: LOADING,
  });
  const [generation, setGeneration] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key === null) return undefined;
    const controller = new AbortController();
    const settle = (state: SiteAuditLoadState<T>) => {
      if (!controller.signal.aborted) setKeyed({
        key,
        state,
      });
    };
    loadRef.current(controller.signal).then((value) => settle({
      status: 'success',
      value,
    }), (failure: unknown) => {
      if (isAbortError(failure)) return;
      console.error('[site-audit] Request failed:', failure);
      settle({
        status: 'error',
        message: seoErrorMessage(failure),
      });
    });
    return () => controller.abort();
  }, [key, generation]);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  return {
    state: keyed.key === key ? keyed.state : LOADING,
    reload,
  };
}
