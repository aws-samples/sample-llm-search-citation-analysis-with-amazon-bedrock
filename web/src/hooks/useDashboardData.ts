import {
  useState, useEffect, useRef, useCallback 
} from 'react';
import {
  API_BASE_URL,
  authenticatedFetch,
  getErrorMessage,
  isAbortError,
  ApiConfigError,
  ApiRequestError,
} from '../infrastructure';
import type {
  Stats, Citations, Search, Keyword 
} from '../types';

/** @internal Response from the searches API */
interface SearchesResponse { searches: Search[] }

/** @internal Response from the keywords API */
interface KeywordsResponse { keywords: Keyword[] }

function isStats(data: unknown): data is Stats {
  return typeof data === 'object' && data !== null && 'total_searches' in data;
}

function isCitations(data: unknown): data is Citations {
  return typeof data === 'object' && data !== null && 'provider_stats' in data;
}

function isSearchesResponse(data: unknown): data is SearchesResponse {
  return typeof data === 'object' && data !== null && 'searches' in data;
}

function isKeywordsResponse(data: unknown): data is KeywordsResponse {
  return typeof data === 'object' && data !== null && 'keywords' in data;
}

function getEmptyStats(): Stats {
  return {
    total_searches: 0,
    total_citations: 0,
    total_crawled: 0,
    unique_keywords: 0 
  };
}

function getEmptyCitations(): Citations {
  return {
    provider_stats: [],
    brand_stats: [],
    top_urls: [] 
  };
}

function validateApiConfig(): void {
  if (API_BASE_URL.includes('PLACEHOLDER')) {
    throw new ApiConfigError('API URL not configured. Please set VITE_API_URL environment variable or deploy the application.');
  }
}

function validateResponses(responses: Response[]): void {
  const allOk = responses.every(r => r.ok);
  if (!allOk) {
    throw new ApiRequestError('Failed to fetch data from API. Please check your API Gateway URL.');
  }
}

/**
 * Hook for fetching dashboard data.
 * Loads statistics, citations, searches, and keywords in parallel.
 * Automatically fetches on mount and provides refetch capability.
 * 
 * @returns Object containing:
 * - `stats` - Dashboard statistics (totals for searches, citations, etc.)
 * - `citations` - Citation data with provider stats and top URLs
 * - `searches` - Recent search results
 * - `keywords` - List of tracked keywords
 * - `setKeywords` - Function to update keywords state locally
 * - `loading` - Whether data is being fetched
 * - `error` - Error message if fetch failed
 * - `lastUpdate` - Timestamp of last successful fetch
 * - `refetch` - Function to refresh all data
 * 
 * @example
 * ```tsx
 * const { stats, citations, loading, refetch } = useDashboardData();
 * 
 * if (loading) return <Spinner />;
 * 
 * return (
 *   <Dashboard
 *     totalSearches={stats?.total_searches}
 *     topUrls={citations?.top_urls}
 *     onRefresh={refetch}
 *   />
 * );
 * ```
 */
export const useDashboardData = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [citations, setCitations] = useState<Citations | null>(null);
  const [searches, setSearches] = useState<Search[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const controllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    const signal = controllerRef.current.signal;

    try {
      setLoading(true);
      validateApiConfig();

      const responses = await Promise.all([
        authenticatedFetch(`${API_BASE_URL}/stats`, { signal }),
        authenticatedFetch(`${API_BASE_URL}/citations`, { signal }),
        authenticatedFetch(`${API_BASE_URL}/searches`, { signal }),
        authenticatedFetch(`${API_BASE_URL}/keywords`, { signal }),
      ]);

      validateResponses(responses);

      const jsonResults = await Promise.all(
        responses.map(async (r): Promise<unknown> => r.json())
      );
      const [statsJson, citationsJson, searchesJson, keywordsJson] = jsonResults;

      if (isStats(statsJson)) setStats(statsJson);
      if (isCitations(citationsJson)) setCitations(citationsJson);
      if (isSearchesResponse(searchesJson)) setSearches(searchesJson.searches ?? []);
      if (isKeywordsResponse(keywordsJson)) setKeywords(keywordsJson.keywords ?? []);
      
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      if (isAbortError(err)) return;
      
      setError(getErrorMessage(err, 'dashboard'));
      console.error('[dashboard] Error fetching data:', err);
      
      setStats(getEmptyStats());
      setCitations(getEmptyCitations());
      setSearches([]);
      setKeywords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    return () => controllerRef.current?.abort();
  }, [fetchData]);

  return {
    stats,
    citations,
    searches,
    keywords,
    setKeywords,
    loading,
    error,
    lastUpdate,
    refetch: fetchData,
  };
};
