import {
  useCallback, useRef, useState
} from 'react';
import type {
  Dispatch, SetStateAction
} from 'react';
import { fetchContentHistory } from '../api/contentStudio';
import type { DecodedContentHistory } from '../api/contentStudioDecoders';
import type { ContentStudioHistory } from '../types';

/** Items per history page; the API also cuts a page at its response budget. */
export const CONTENT_HISTORY_PAGE_SIZE = 20;

/** `current` plus the items of `page` it does not hold yet (by `id`), in page order. */
export function appendHistoryPage<TItem extends { readonly id: string }>(
  current: readonly TItem[],
  page: readonly TItem[]
): TItem[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...page.filter((item) => !seen.has(item.id))];
}

/**
 * A refreshed newest page over a list that already holds older pages: the
 * new page replaces everything in its time window, and loaded items older
 * than its oldest item stay below it.
 */
export function withRefreshedFirstPage(
  current: readonly ContentStudioHistory[],
  firstPage: readonly ContentStudioHistory[]
): ContentStudioHistory[] {
  if (firstPage.length === 0) return [];
  const oldest = firstPage.reduce((min, item) => (item.created_at < min ? item.created_at : min), firstPage[0].created_at);
  const ids = new Set(firstPage.map((item) => item.id));
  return [...firstPage, ...current.filter((item) => !ids.has(item.id) && item.created_at < oldest)];
}

export interface ContentHistoryPaging {
  /** Stores a refreshed newest page, keeping older pages the user loaded. */
  applyFirstPage: (page: DecodedContentHistory) => void;
  loadMoreHistory: () => Promise<void>;
  historyHasMore: boolean;
  historyLoadingMore: boolean;
}

/** Older Content Studio history pages, loaded on demand below the newest page. */
export function useContentHistoryPaging(
  setHistory: Dispatch<SetStateAction<ContentStudioHistory[]>>,
  onError: (error: unknown) => void
): ContentHistoryPaging {
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const loadedOlderRef = useRef(false);

  const applyFirstPage = useCallback((page: DecodedContentHistory) => {
    if (loadedOlderRef.current) {
      setHistory((current) => withRefreshedFirstPage(current, page.history));
      return;
    }
    setHistory(page.history);
    setNextToken(page.nextToken);
  }, [setHistory]);

  const loadMoreHistory = useCallback(async () => {
    if (nextToken === null) return;
    setHistoryLoadingMore(true);
    try {
      const page = await fetchContentHistory(CONTENT_HISTORY_PAGE_SIZE, undefined, nextToken);
      loadedOlderRef.current = true;
      setHistory((current) => appendHistoryPage(current, page.history));
      setNextToken(page.nextToken);
    } catch (requestError) {
      onError(requestError);
    } finally {
      setHistoryLoadingMore(false);
    }
  }, [nextToken, onError, setHistory]);

  return {
    applyFirstPage,
    loadMoreHistory,
    historyHasMore: nextToken !== null,
    historyLoadingMore,
  };
}
