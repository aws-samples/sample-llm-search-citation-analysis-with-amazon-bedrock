import {
  useState, useCallback, useRef
} from 'react';
import {
  deleteKeywordResearch, fetchKeywordResearchHistoryPage, type ResearchType
} from '../api/keywordResearch';
import type { KeywordResearchItem } from '../types';
import { appendHistoryPage } from './useContentHistoryPaging';

export interface ResearchHistoryPages {
  history: KeywordResearchItem[];
  historyLoading: boolean;
  /** True while a further page is being appended. */
  historyLoadingMore: boolean;
  /** The API has older jobs than the loaded ones. */
  historyHasMore: boolean;
  /** Reloads the newest page (of `type` only, when given). */
  fetchHistory: (type?: ResearchType) => Promise<void>;
  /** Appends the next page of the last `fetchHistory` listing. */
  loadMoreHistory: () => Promise<void>;
  deleteResearch: (id: string) => Promise<void>;
}

/**
 * The research history list, newest first, one API page at a time: the
 * newest page on refresh and older pages on demand (`loadMoreHistory`). A
 * page can hold a few jobs only, since each carries its merged results.
 */
export function useResearchHistoryPages(): ResearchHistoryPages {
  const [history, setHistory] = useState<KeywordResearchItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const listingRef = useRef<{ type?: ResearchType }>({});

  const fetchHistory = useCallback(async (type?: ResearchType) => {
    const listing = { type };
    listingRef.current = listing;
    setHistoryLoading(true);
    try {
      const page = await fetchKeywordResearchHistoryPage(type);
      if (listingRef.current !== listing) return;
      setHistory(page.items);
      setNextToken(page.nextToken);
    } catch (err) {
      console.error('[research] Error fetching history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadMoreHistory = useCallback(async () => {
    if (nextToken === null) return;
    const listing = listingRef.current;
    setHistoryLoadingMore(true);
    try {
      const page = await fetchKeywordResearchHistoryPage(listing.type, nextToken);
      if (listingRef.current !== listing) return;
      setHistory((current) => appendHistoryPage(current, page.items));
      setNextToken(page.nextToken);
    } catch (err) {
      console.error('[research] Error loading more history:', err);
    } finally {
      setHistoryLoadingMore(false);
    }
  }, [nextToken]);

  const deleteResearch = useCallback(async (id: string) => {
    try {
      await deleteKeywordResearch(id);
      setHistory((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error('[research] Error deleting research:', err);
    }
  }, []);

  return {
    history,
    historyLoading,
    historyLoadingMore,
    historyHasMore: nextToken !== null,
    fetchHistory,
    loadMoreHistory,
    deleteResearch,
  };
}
