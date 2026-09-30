import {
  useCallback, useEffect, useLayoutEffect, useRef, useState
} from 'react';
import { validateApiConfig } from '../api/client';
import { fetchAllKeywords } from '../api/keywordPages';
import {
  API_BASE_URL,
  authenticatedFetch,
  getErrorMessage,
  isAbortError,
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

function isStats(value: unknown): value is Stats {
  return typeof value === 'object' && value !== null && 'total_searches' in value;
}

function isCitations(value: unknown): value is Citations {
  return typeof value === 'object' && value !== null && 'provider_stats' in value;
}

function isSearchesResponse(value: unknown): value is SearchesResponse {
  // Array check matters (AUDIT-2026-08-19 2.17): a key-only check let
  // `{"searches": null}` put null into Search[] state and blank the view.
  return (
    typeof value === 'object'
    && value !== null
    && 'searches' in value
    && Array.isArray(value.searches)
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

function validateResponses(responses: Response[]): void {
  const allResponsesSucceeded = responses.every(response => response.ok);
  if (!allResponsesSucceeded) {
    throw new ApiRequestError('Failed to fetch data from API. Please check your API Gateway URL.');
  }
}

/** Stats, citations and searches payloads, in that order. */
async function fetchPanelPayloads(signal: AbortSignal): Promise<unknown[]> {
  const responses = await Promise.all([
    authenticatedFetch(`${API_BASE_URL}/stats`, { signal }),
    authenticatedFetch(`${API_BASE_URL}/citations`, { signal }),
    authenticatedFetch(`${API_BASE_URL}/searches`, { signal }),
  ]);

  validateResponses(responses);

  return Promise.all(
    responses.map(async (response): Promise<unknown> => response.json())
  );
}

interface DashboardPayloads {
  panelPayloads: unknown[];
  keywordList: Keyword[];
}

/**
 * Panels and every keyword page, fetched in parallel. A panel failure takes
 * precedence over a keyword failure so the dashboard message stays the
 * panels' one when both fail.
 */
async function fetchDashboardPayloads(signal: AbortSignal): Promise<DashboardPayloads> {
  const [panelOutcome, keywordOutcome] = await Promise.allSettled([
    fetchPanelPayloads(signal),
    fetchAllKeywords({ signal }),
  ]);
  if (panelOutcome.status === 'rejected') throw panelOutcome.reason;
  if (keywordOutcome.status === 'rejected') throw keywordOutcome.reason;
  return {
    panelPayloads: panelOutcome.value,
    keywordList: keywordOutcome.value,
  };
}

/**
 * Fetches dashboard data and owns authoritative keyword reconciliation.
 * Both the ordinary load and promotion reconciliation read every
 * `/keywords` page (`fetchAllKeywords`); reconciliation reads them with
 * `authoritative=true`. A failed or malformed page applies no keywords.
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
    panelPayloads: unknown[],
    keywordList: Keyword[],
    requestKeywordGeneration: number
  ): void => {
    const [statsJson, citationsJson, searchesJson] = panelPayloads;

    if (isStats(statsJson)) setStats(statsJson);
    if (isCitations(citationsJson)) setCitations(citationsJson);
    if (isSearchesResponse(searchesJson)) setSearches(searchesJson.searches);
    if (keywordGenerationRef.current === requestKeywordGeneration) {
      setKeywords(keywordList);
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
    const isCurrent = () => ownerMountedRef.current
      && dashboardGenerationRef.current === dashboardGeneration;

    try {
      setLoading(true);
      validateApiConfig();

      const {
        panelPayloads, keywordList
      } = await fetchDashboardPayloads(signal);
      if (!isCurrent()) return;

      applyDashboardResults(panelPayloads, keywordList, keywordGeneration);
    } catch (fetchError) {
      if (isAbortError(fetchError)) return;
      if (!isCurrent()) return;

      setError(getErrorMessage(fetchError, 'dashboard'));
      console.error('[dashboard] Error fetching data:', fetchError);
      resetDashboardResults(keywordGeneration);
    } finally {
      if (dashboardControllerRef.current === dashboardController) {
        dashboardControllerRef.current = null;
      }
      if (isCurrent()) {
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
    const isCurrent = () => ownerMountedRef.current
      && keywordGenerationRef.current === keywordGeneration;

    try {
      const reconciledKeywords = await fetchAllKeywords({
        signal: keywordController.signal,
        authoritative: true,
      });
      if (!isCurrent()) return;

      setKeywords(reconciledKeywords);
    } catch (reconciliationError) {
      if (!isAbortError(reconciliationError) && isCurrent()) {
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
