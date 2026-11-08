import {
  useCallback, useEffect, useRef, useState
} from 'react';
import { fetchAlerts } from '../api/alerts';
import type {
  AlertItem, AlertStatusFilter
} from '../types';
import {
  getErrorMessage, isAbortError
} from '../infrastructure';

/** Alerts per page of the full list (the API's largest page). */
export const ALERT_LIST_PAGE = 100;

export interface AlertList {
  readonly items: readonly AlertItem[];
  /** Every alert of the status, when the API says (2.45.0 wave 5). */
  readonly total: number | null;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  /** Appends the next page; `undefined` on the last. */
  readonly loadMore: (() => Promise<void>) | undefined;
  /** Marks an alert acknowledged in the list once the API acknowledged it. */
  readonly markAcknowledged: (id: string) => void;
}

interface ListState {
  readonly items: readonly AlertItem[];
  readonly nextToken: string | null;
  readonly total: number | null;
}

const EMPTY: ListState = {
  items: [],
  nextToken: null,
  total: null,
};

/**
 * Every alert of `status` (2.45.0 wave 5: the dashboard listed the first 20 open ones), newest
 * first as the API pages them, a page at a time ("Load more alerts" over `next_token`).
 */
export function useAlertList(status: AlertStatusFilter): AlertList {
  const [state, setState] = useState<ListState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const read = useCallback(async (nextToken: string | null) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    try {
      const page = await fetchAlerts({
        status,
        limit: ALERT_LIST_PAGE,
        nextToken,
        signal: controller.signal,
      });
      setState((current) => ({
        items: nextToken === null ? page.items : [...current.items, ...page.items],
        nextToken: page.next_token ?? null,
        total: page.total ?? null,
      }));
    } catch (requestError) {
      if (!isAbortError(requestError)) setError(getErrorMessage(requestError, 'alerts'));
    }
  }, [status]);

  useEffect(() => {
    setState(EMPTY);
    setLoading(true);
    void read(null).finally(() => setLoading(false));
    return () => controllerRef.current?.abort();
  }, [read]);

  const { nextToken } = state;
  const loadNext = useCallback(async () => {
    setLoadingMore(true);
    await read(nextToken);
    setLoadingMore(false);
  }, [read, nextToken]);

  const markAcknowledged = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? {
        ...item,
        status: 'acknowledged',
      } : item)),
    }));
  }, []);

  return {
    items: state.items,
    total: state.total,
    loading,
    loadingMore,
    error,
    loadMore: nextToken === null ? undefined : loadNext,
    markAcknowledged,
  };
}
