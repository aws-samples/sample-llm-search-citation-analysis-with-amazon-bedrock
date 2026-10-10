import {
  useCallback, useMemo, useState
} from 'react';
import {
  fetchMarkets, MarketsInUseError, saveMarkets
} from '../api/markets';
import type {
  Market, MarketsListing
} from '../types';
import {
  useGuardedLoad, type GuardedLoadSource
} from './useGuardedLoad';

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

const NO_MARKETS: Market[] = [];

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

/** `GET /markets`; `null` until the list has been read once. */
const MARKETS_SOURCE: GuardedLoadSource<MarketsListing | null> = {
  initial: null,
  load: fetchMarkets,
  errorMessage: (failure) => failureMessage(failure, 'Could not load the markets'),
};

/**
 * The configured markets (`GET /markets`, loaded on mount) and the admin's
 * save of a whole new list (`PUT /markets`). A refused save keeps the stored
 * list; a successful one replaces it with what the server stored.
 */
export function useMarkets() {
  const {
    data: listing, loading, error, reload: reloadListing, setData: setListing, isMounted
  } = useGuardedLoad(MARKETS_SOURCE);
  const [saveOutcome, setSaveOutcome] = useState<MarketsSaveOutcome>(IDLE);

  const reload = useCallback((): void => {
    void reloadListing();
  }, [reloadListing]);

  const save = useCallback(async (next: readonly Market[]): Promise<boolean> => {
    setSaveOutcome({ status: 'saving' });
    try {
      const stored = await saveMarkets(next);
      if (!isMounted()) return true;
      setListing(stored);
      setSaveOutcome({ status: 'saved' });
      return true;
    } catch (failure) {
      if (isMounted()) setSaveOutcome(failedSave(failure));
      return false;
    }
  }, [isMounted, setListing]);

  return useMemo(() => ({
    markets: listing?.markets ?? NO_MARKETS,
    updatedAt: listing?.updated_at ?? null,
    loading,
    /** The list has been read at least once, so an empty `markets` means none are configured. */
    loaded: listing !== null,
    error,
    saveOutcome,
    reload,
    save,
  }), [listing, loading, error, saveOutcome, reload, save]);
}

export type MarketsController = ReturnType<typeof useMarkets>;
