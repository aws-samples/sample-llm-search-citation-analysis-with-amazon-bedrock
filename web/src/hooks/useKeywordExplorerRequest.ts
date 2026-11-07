import {
  useCallback, useEffect, useRef, useState
} from 'react';
import { seoErrorMessage } from '../api/seo';
import { isAbortError } from '../infrastructure';

/** One on-demand SEO request: nothing asked yet, in flight, answered, or failed with the message to show. */
export type SeoRequestState<TResponse> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
    readonly status: 'success';
    readonly response: TResponse;
  }
  | {
    readonly status: 'error';
    readonly message: string;
  };

const IDLE = { status: 'idle' } satisfies SeoRequestState<never>;

export interface SeoRequest<TRequest, TResponse> {
  readonly state: SeoRequestState<TResponse>;
  /** Sends `request` once (a paid call: never on focus, never retried); a newer `run` or `reset` supersedes it. */
  readonly run: (request: TRequest) => Promise<void>;
  readonly reset: () => void;
}

type SeoCall<TRequest, TResponse> = (request: TRequest, options: { signal: AbortSignal }) => Promise<TResponse>;

/**
 * State of an SEO request the user starts (Search, a SERP click). Only the
 * latest call's answer is kept; an unmount aborts the call in flight.
 */
export function useSeoRequest<TRequest, TResponse>(call: SeoCall<TRequest, TResponse>): SeoRequest<TRequest, TResponse> {
  const [state, setState] = useState<SeoRequestState<TResponse>>(IDLE);
  const activeRef = useRef<AbortController | null>(null);

  const supersede = useCallback(() => {
    activeRef.current?.abort();
    activeRef.current = null;
  }, []);

  useEffect(() => supersede, [supersede]);

  const run = useCallback(async (request: TRequest) => {
    supersede();
    const controller = new AbortController();
    activeRef.current = controller;
    setState({ status: 'loading' });
    try {
      const response = await call(request, { signal: controller.signal });
      if (activeRef.current === controller) {
        setState({
          status: 'success',
          response,
        });
      }
    } catch (failure) {
      if (activeRef.current !== controller || isAbortError(failure)) return;
      console.error('[seo] Request failed:', failure);
      setState({
        status: 'error',
        message: seoErrorMessage(failure),
      });
    } finally {
      if (activeRef.current === controller) activeRef.current = null;
    }
  }, [call, supersede]);

  const reset = useCallback(() => {
    supersede();
    setState(IDLE);
  }, [supersede]);

  return {
    state,
    run,
    reset,
  };
}
