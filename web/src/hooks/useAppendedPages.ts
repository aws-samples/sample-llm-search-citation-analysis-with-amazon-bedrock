import {
  useCallback, useEffect, useRef, useState
} from 'react';
import { apiGet } from '../api/client';
import {
  ApiRequestError, getErrorMessage, isAbortError
} from '../infrastructure';

/** The GET a first page answered: its path and query. */
interface PageRequest {
  readonly path: string;
  readonly params?: URLSearchParams;
}

/** How to read the rows and the cursor of one page. */
export interface PageReader<P, I> {
  readonly isPage: (value: unknown) => value is P;
  readonly itemsOf: (page: P) => readonly I[];
  readonly tokenOf: (page: P) => string | null;
}

export interface AppendedPages<I> {
  /** The rows of every page loaded after the first. */
  readonly items: readonly I[];
  /** Loads the next page; `undefined` once the last page is loaded (or before the first one). */
  readonly loadMore: (() => Promise<void>) | undefined;
  readonly loadingMore: boolean;
  readonly error: string | null;
}

/**
 * The pages after a first page that a view already holds (2.45.0 wave 5: the group KPI drivers and
 * a keyword's runs), read on demand with the first page's GET plus `next_token`. A new first page
 * (another request or cursor) starts over.
 */
export function useAppendedPages<P, I>(
  request: PageRequest | null,
  firstToken: string | null,
  reader: PageReader<P, I>,
): AppendedPages<I> {
  const [items, setItems] = useState<readonly I[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(firstToken);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    setItems([]);
    setNextToken(firstToken);
    setLoadingMore(false);
    setError(null);
  }, [request, firstToken]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const {
    isPage, itemsOf, tokenOf 
  } = reader;
  const loadNext = useCallback(async (): Promise<void> => {
    if (request === null || nextToken === null) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const params = Object.fromEntries(new URLSearchParams(request.params ?? '').entries());
      params.next_token = nextToken;
      const body = await apiGet<unknown>(request.path, {
        params,
        signal: controller.signal,
      });
      if (!isPage(body)) throw new ApiRequestError('Invalid list page');
      setItems((loaded) => [...loaded, ...itemsOf(body)]);
      setNextToken(tokenOf(body));
    } catch (pageError) {
      if (!isAbortError(pageError)) setError(getErrorMessage(pageError, 'visibility'));
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, [request, nextToken, isPage, itemsOf, tokenOf]);

  return {
    items,
    loadMore: request !== null && nextToken !== null ? loadNext : undefined,
    loadingMore,
    error,
  };
}
