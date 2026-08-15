import {
  useCallback, useEffect, useLayoutEffect, useRef, useState
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

// The KeywordMgmt Lambda has a 120-second timeout. This second refresh runs
// after that ceiling so an abandoned browser request cannot remain stale if
// the Lambda commits after the immediate reconciliation read.
export const LATE_KEYWORD_RECONCILIATION_MS = 125_000;

/** @internal Response from the searches API */
interface SearchesResponse { searches: Search[] }

/** @internal Response from the ordinary keywords API */
interface KeywordsResponse { keywords: Keyword[] }

/** @internal Complete response from the authoritative keywords API */
interface AuthoritativeKeywordsResponse {
  keywords: Keyword[];
  count: number;
  complete: true;
}

function isStats(value: unknown): value is Stats {
  return typeof value === 'object' && value !== null && 'total_searches' in value;
}

function isCitations(value: unknown): value is Citations {
  return typeof value === 'object' && value !== null && 'provider_stats' in value;
}

function isSearchesResponse(value: unknown): value is SearchesResponse {
  return typeof value === 'object' && value !== null && 'searches' in value;
}

function isKeywordStatus(value: unknown): value is Keyword['status'] {
  return value === undefined || value === 'active' || value === 'inactive' || value === 'paused';
}

function isKeyword(value: unknown): value is Keyword {
  return (
    typeof value === 'object'
    && value !== null
    && 'id' in value
    && typeof value.id === 'string'
    && 'keyword' in value
    && typeof value.keyword === 'string'
    && 'created_at' in value
    && typeof value.created_at === 'string'
    && (!('status' in value) || isKeywordStatus(value.status))
  );
}

function isKeywordsResponse(value: unknown): value is KeywordsResponse {
  return (
    typeof value === 'object'
    && value !== null
    && 'keywords' in value
    && Array.isArray(value.keywords)
    && value.keywords.every(isKeyword)
  );
}

function isAuthoritativeKeywordsResponse(value: unknown): value is AuthoritativeKeywordsResponse {
  return (
    isKeywordsResponse(value)
    && 'count' in value
    && typeof value.count === 'number'
    && Number.isInteger(value.count)
    && value.count === value.keywords.length
    && 'complete' in value
    && value.complete === true
  );
}

function getEmptyStats(): Stats {
  return {
    total_searches: 0,
    total_citations: 0,
    total_crawled: 0,
    unique_keywords: 0,
  };
}

function getEmptyCitations(): Citations {
  return {
    provider_stats: [],
    brand_stats: [],
    top_urls: [],
  };
}

function validateApiConfig(): void {
  if (API_BASE_URL.includes('PLACEHOLDER')) {
    throw new ApiConfigError('API URL not configured. Please set VITE_API_URL environment variable or deploy the application.');
  }
}

function validateResponses(responses: Response[]): void {
  const allResponsesSucceeded = responses.every(response => response.ok);
  if (!allResponsesSucceeded) {
    throw new ApiRequestError('Failed to fetch data from API. Please check your API Gateway URL.');
  }
}

/**
 * Fetches dashboard data and owns authoritative keyword reconciliation.
 * Ordinary dashboard loads retain the `/keywords` endpoint, while promotion
 * reconciliation uses the complete authoritative keyword snapshot.
 */
export const useDashboardData = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [citations, setCitations] = useState<Citations | null>(null);
  const [searches, setSearches] = useState<Search[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const dashboardControllerRef = useRef<AbortController | null>(null);
  const keywordControllerRef = useRef<AbortController | null>(null);
  const lateReconciliationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dashboardGenerationRef = useRef(0);
  const keywordGenerationRef = useRef(0);
  const ownerMountedRef = useRef(true);

  const applyDashboardResults = useCallback((
    jsonResults: unknown[],
    requestKeywordGeneration: number
  ): void => {
    const [statsJson, citationsJson, searchesJson, keywordsJson] = jsonResults;

    if (isStats(statsJson)) setStats(statsJson);
    if (isCitations(citationsJson)) setCitations(citationsJson);
    if (isSearchesResponse(searchesJson)) setSearches(searchesJson.searches);
    if (
      keywordGenerationRef.current === requestKeywordGeneration
      && isKeywordsResponse(keywordsJson)
    ) {
      setKeywords(keywordsJson.keywords);
    }

    setLastUpdate(new Date());
    setError(null);
  }, []);

  const resetDashboardResults = useCallback((requestKeywordGeneration: number): void => {
    setStats(getEmptyStats());
    setCitations(getEmptyCitations());
    setSearches([]);
    if (keywordGenerationRef.current === requestKeywordGeneration) {
      setKeywords([]);
    }
  }, []);

  const fetchData = useCallback(async (): Promise<void> => {
    if (!ownerMountedRef.current) return;

    dashboardGenerationRef.current += 1;
    keywordGenerationRef.current += 1;
    const dashboardGeneration = dashboardGenerationRef.current;
    const keywordGeneration = keywordGenerationRef.current;

    dashboardControllerRef.current?.abort();
    keywordControllerRef.current?.abort();
    keywordControllerRef.current = null;

    const dashboardController = new AbortController();
    dashboardControllerRef.current = dashboardController;
    const { signal } = dashboardController;

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
        responses.map(async (response): Promise<unknown> => response.json())
      );
      const dashboardRequestIsCurrent = ownerMountedRef.current
        && dashboardGenerationRef.current === dashboardGeneration;

      if (!dashboardRequestIsCurrent) return;

      applyDashboardResults(jsonResults, keywordGeneration);
    } catch (fetchError) {
      if (isAbortError(fetchError)) return;

      const dashboardRequestIsCurrent = ownerMountedRef.current
        && dashboardGenerationRef.current === dashboardGeneration;
      if (!dashboardRequestIsCurrent) return;

      setError(getErrorMessage(fetchError, 'dashboard'));
      console.error('[dashboard] Error fetching data:', fetchError);
      resetDashboardResults(keywordGeneration);
    } finally {
      if (dashboardControllerRef.current === dashboardController) {
        dashboardControllerRef.current = null;
      }
      if (ownerMountedRef.current && dashboardGenerationRef.current === dashboardGeneration) {
        setLoading(false);
      }
    }
  }, [applyDashboardResults, resetDashboardResults]);

  const refreshAuthoritativeKeywords = useCallback(async (): Promise<void> => {
    if (!ownerMountedRef.current) return;

    keywordGenerationRef.current += 1;
    const keywordGeneration = keywordGenerationRef.current;

    keywordControllerRef.current?.abort();
    const keywordController = new AbortController();
    keywordControllerRef.current = keywordController;

    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/keywords?authoritative=true`,
        { signal: keywordController.signal }
      );
      const keywordRequestIsCurrent = ownerMountedRef.current
        && keywordGenerationRef.current === keywordGeneration;
      if (!keywordRequestIsCurrent) return;

      if (!response.ok) {
        throw new ApiRequestError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status
        );
      }

      const payload: unknown = await response.json();
      const parsedRequestIsCurrent = ownerMountedRef.current
        && keywordGenerationRef.current === keywordGeneration;
      if (!parsedRequestIsCurrent) return;

      if (!isAuthoritativeKeywordsResponse(payload)) {
        throw new TypeError('Authoritative keywords API returned an invalid response');
      }

      setKeywords(payload.keywords);
    } catch (reconciliationError) {
      const keywordRequestIsCurrent = ownerMountedRef.current
        && keywordGenerationRef.current === keywordGeneration;
      if (!isAbortError(reconciliationError) && keywordRequestIsCurrent) {
        console.error('[keywords] Error reconciling active keywords:', reconciliationError);
      }
    } finally {
      if (keywordControllerRef.current === keywordController) {
        keywordControllerRef.current = null;
      }
    }
  }, []);

  const reconcileKeywords = useCallback(async (): Promise<void> => {
    if (!ownerMountedRef.current) return;

    if (lateReconciliationTimerRef.current !== null) {
      clearTimeout(lateReconciliationTimerRef.current);
    }
    lateReconciliationTimerRef.current = setTimeout(() => {
      lateReconciliationTimerRef.current = null;
      if (!ownerMountedRef.current) return;
      void refreshAuthoritativeKeywords();
    }, LATE_KEYWORD_RECONCILIATION_MS);

    await refreshAuthoritativeKeywords();
  }, [refreshAuthoritativeKeywords]);

  useLayoutEffect(() => {
    ownerMountedRef.current = true;

    return () => {
      ownerMountedRef.current = false;
      if (lateReconciliationTimerRef.current !== null) {
        clearTimeout(lateReconciliationTimerRef.current);
        lateReconciliationTimerRef.current = null;
      }
      dashboardGenerationRef.current += 1;
      keywordGenerationRef.current += 1;
      dashboardControllerRef.current?.abort();
      dashboardControllerRef.current = null;
      keywordControllerRef.current?.abort();
      keywordControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    void fetchData();
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
    reconcileKeywords,
  };
};
