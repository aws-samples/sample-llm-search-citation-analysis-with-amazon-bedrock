import {
  useEffect, useRef, useState
} from 'react';
import { getErrorMessage } from '../infrastructure';
import { isSeoApiConfigured } from '../api/seo';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';

export interface SeoRequestState<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const IDLE: SeoRequestState<never> = {
  data: null,
  loading: false,
  error: null,
};

const PENDING: SeoRequestState<never> = {
  data: null,
  loading: true,
  error: null,
};

/**
 * One read of the SEO API: `load` runs when `active` turns on and again
 * whenever `requestKey` changes (never on focus or retry: the SEO hooks
 * read on demand); a superseded answer is dropped. Idle while inactive.
 */
export function useSeoRequest<T>(active: boolean, requestKey: string, load: () => Promise<T>): SeoRequestState<T> {
  const [state, setState] = useState<SeoRequestState<T>>(active ? PENDING : IDLE);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!active) {
      setState(IDLE);
      return undefined;
    }
    const outcome = { cancelled: false };
    const settle = (next: SeoRequestState<T>) => {
      if (!outcome.cancelled) setState(next);
    };
    setState(PENDING);
    loadRef.current().then(
      (data) => settle({
        ...IDLE,
        data,
      }),
      (error: unknown) => settle({
        ...IDLE,
        error: getErrorMessage(error),
      }),
    );
    return () => {
      outcome.cancelled = true;
    };
  }, [active, requestKey]);

  return state;
}

/** The scope of a SEO vs GEO read: the header market (none = global) and the keyword group, if any. */
export interface SeoScopeParams {
  market_id?: string;
  group_id?: string;
}

export interface SeoScopeRequest<T> extends SeoRequestState<T> {
  /** The SEO stack is not deployed (`VITE_SEO_API_URL` empty): nothing is fetched. */
  readonly notConfigured: boolean;
}

/** `load` for the header market and `groupId`, read on mount and whenever either changes (free reads only). */
export function useSeoScopeRequest<T>(groupId: string | null, load: (params: SeoScopeParams) => Promise<T>): SeoScopeRequest<T> {
  const marketId = useSelectedMarketId();
  const configured = isSeoApiConfigured();
  const params: SeoScopeParams = {
    ...(marketId === null ? {} : { market_id: marketId }),
    ...(groupId === null ? {} : { group_id: groupId }),
  };
  const state = useSeoRequest(configured, `${marketId ?? ''}|${groupId ?? ''}`, () => load(params));
  return {
    ...state,
    notConfigured: !configured,
  };
}
