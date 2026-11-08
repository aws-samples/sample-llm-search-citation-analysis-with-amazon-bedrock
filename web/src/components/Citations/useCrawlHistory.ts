import {
  useCallback, useEffect, useState
} from 'react';
import { fetchCrawlHistory } from '../../api/dashboard';
import type { HistoryCrawl } from './CrawlHistory';

/**
 * A URL's crawl history for the citation modal's History tab: the first page once `enabled`
 * (the tab is open), then "Load older crawls" over the API cursor until every crawl is listed.
 */
export function useCrawlHistory(url: string, enabled: boolean) {
  const [history, setHistory] = useState<HistoryCrawl[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchCrawlHistory(url);
      setHistory(page.items);
      setNextToken(page.nextToken);
      setLoaded(true);
    } catch (err) {
      setError('Failed to load crawl history');
      console.error('Error loading history:', err);
    } finally {
      setLoading(false);
    }
  }, [url]);

  const loadMore = useCallback(async () => {
    if (nextToken === null) return;
    setLoadingMore(true);
    try {
      const page = await fetchCrawlHistory(url, nextToken);
      setHistory((current) => [...current, ...page.items]);
      setNextToken(page.nextToken);
    } catch (err) {
      setError('Failed to load older crawls');
      console.error('Error loading older crawls:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [url, nextToken]);

  useEffect(() => {
    if (enabled && !loaded && !loading && error === null) void load();
  }, [enabled, loaded, loading, error, load]);

  return {
    history,
    loading,
    loadingMore,
    error,
    retry: load,
    loadMore: nextToken === null ? undefined : loadMore,
  };
}
