import {
  useCallback, useEffect, useMemo, useState
} from 'react';
import {
  fetchMarkets, MarketsInUseError, saveMarkets
} from '../api/markets';
import type { Market } from '../types';
import { useLatestRequest } from './useLatestRequest';

/** How the latest save ended: `inUse` lists the markets keywords still use (the 409). */
export type MarketsSaveOutcome =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' }
  | { readonly status: 'saved' }
  | {
    readonly status: 'failed';
    readonly message: string;
    readonly inUse: readonly string[];
  };

const IDLE: MarketsSaveOutcome = { status: 'idle' };

/** The message of a thrown error, else `fallback`. */
export function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback;
}

function failedSave(error: unknown): MarketsSaveOutcome {
  return {
    status: 'failed',
    message: failureMessage(error, 'Could not save the markets'),
    inUse: error instanceof MarketsInUseError ? error.marketIds : [],
  };
}

/**
 * The configured markets (`GET /markets`, loaded on mount) and the admin's
 * save of a whole new list (`PUT /markets`). A refused save keeps the stored
 * list; a successful one replaces it with what the server stored.
 */
export function useMarkets() {
  const {
    beginRequest, isMounted
  } = useLatestRequest();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOutcome, setSaveOutcome] = useState<MarketsSaveOutcome>(IDLE);

  const reload = useCallback(() => {
    const request = beginRequest();
    setLoading(true);
    setError(null);
    fetchMarkets(request.signal)
      .then((listing) => {
        if (!request.isCurrent()) return;
        setMarkets(listing.markets);
        setUpdatedAt(listing.updated_at);
        setLoaded(true);
      })
      .catch((failure: unknown) => {
        if (request.isCurrent()) setError(failureMessage(failure, 'Could not load the markets'));
      })
      .finally(() => {
        if (request.isCurrent()) setLoading(false);
        request.finish();
      });
  }, [beginRequest]);

  useEffect(reload, [reload]);

  const save = useCallback(async (next: readonly Market[]): Promise<boolean> => {
    setSaveOutcome({ status: 'saving' });
    try {
      const listing = await saveMarkets(next);
      if (!isMounted()) return true;
      setMarkets(listing.markets);
      setUpdatedAt(listing.updated_at);
      setLoaded(true);
      setSaveOutcome({ status: 'saved' });
      return true;
    } catch (failure) {
      if (isMounted()) setSaveOutcome(failedSave(failure));
      return false;
    }
  }, [isMounted]);

  return useMemo(() => ({
    markets,
    updatedAt,
    loading,
    /** The list has been read at least once, so an empty `markets` means none are configured. */
    loaded,
    error,
    saveOutcome,
    reload,
    save,
  }), [markets, updatedAt, loading, loaded, error, saveOutcome, reload, save]);
}

export type MarketsController = ReturnType<typeof useMarkets>;
