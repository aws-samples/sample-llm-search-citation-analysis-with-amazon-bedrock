import {
  useCallback, useState
} from 'react';
import type { Search } from '../../types';
import { fetchSearchesPage } from '../../api/searchPages';

/** Rows per "Load more" request. */
export const SEARCHES_PAGE_SIZE = 100;

interface LoadedPages {
  /** The first page these older pages continue; a new first page drops them. */
  readonly first: readonly Search[];
  readonly older: readonly Search[];
  readonly nextToken: string | null;
}

export interface SearchPages {
  /** The first page followed by every older page loaded so far, newest first. */
  readonly searches: Search[];
  /** Whether the API holds older runs than the ones loaded. */
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly loadMore: () => Promise<void>;
}

/**
 * The Recent Searches rows: the dashboard's first page (`first`, whose
 * `firstNextToken` continues it) plus older pages loaded on demand.
 */
export function useSearchPages(first: Search[], firstNextToken: string | null): SearchPages {
  const [loaded, setLoaded] = useState<LoadedPages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = loaded?.first === first ? loaded : null;
  const nextToken = current === null ? firstNextToken : current.nextToken;

  const loadMore = useCallback(async (): Promise<void> => {
    if (nextToken === null) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchSearchesPage({
        limit: String(SEARCHES_PAGE_SIZE),
        next_token: nextToken,
      });
      setLoaded({
        first,
        older: [...(current?.older ?? []), ...page.searches],
        nextToken: page.next_token,
      });
    } catch (loadError) {
      console.error('[searches] Error loading older searches:', loadError);
      setError('Older searches could not be loaded. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  }, [current, first, nextToken]);

  return {
    searches: current === null ? first : [...first, ...current.older],
    hasMore: nextToken !== null,
    loadingMore,
    error,
    loadMore,
  };
}
