import {
  useCallback, useEffect, useLayoutEffect, useRef, useState
} from 'react';
import { validateApiConfig } from '../api/client';
import { fetchAllKeywords } from '../api/keywordPages';
import {
  getErrorMessage,
  isAbortError,
} from '../infrastructure';
import type {
  Stats, Citations, Search, Keyword
} from '../types';
import {
  DASHBOARD_PANELS,
  IDLE_PANEL,
  IDLE_PANEL_STATES,
  loadDashboardPanel,
  type DashboardPanel,
  type DashboardPanelState,
  type DashboardPanelStates,
  type DashboardPanelValue,
} from './dashboardPanels';

// The KeywordMgmt Lambda stops at API Gateway's 29-second ceiling. This
// second refresh runs after that ceiling (plus a margin for the commit to
// become visible) so an abandoned browser request cannot remain stale if the
// Lambda commits after the immediate reconciliation read.
export const LATE_KEYWORD_RECONCILIATION_MS = 35_000;

type PanelControllers = Partial<Record<DashboardPanel, AbortController>>;

/**
 * Fetches dashboard data and owns authoritative keyword reconciliation.
 *
 * Stats, citations, searches and keywords load independently: each panel
 * shows up as soon as its request answers, a failed panel keeps what it had
 * and reports its own error in `panels`, and `retryPanel` reloads just that
 * one. `error` is reserved for a missing API configuration, the one failure
 * no panel can recover from.
 *
 * Both the ordinary load and promotion reconciliation read every
 * `/keywords` page (`fetchAllKeywords`); reconciliation reads them with
 * `authoritative=true`. A failed or malformed page applies no keywords.
 */
export const useDashboardData = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [citations, setCitations] = useState<Citations | null>(null);
  const [searches, setSearches] = useState<Search[]>([]);
  const [searchesNextToken, setSearchesNextToken] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [panels, setPanels] = useState<DashboardPanelStates>(IDLE_PANEL_STATES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const dashboardControllerRef = useRef<AbortController | null>(null);
  const keywordControllerRef = useRef<AbortController | null>(null);
  const panelControllersRef = useRef<PanelControllers>({});
  const lateReconciliationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dashboardGenerationRef = useRef(0);
  const keywordGenerationRef = useRef(0);
  const ownerMountedRef = useRef(true);

  const setPanel = useCallback((panel: DashboardPanel, next: (previous: DashboardPanelState) => DashboardPanelState): void => {
    setPanels((previous) => {
      const updated = next(previous[panel]);
      return updated === previous[panel] ? previous : {
        ...previous,
        [panel]: updated,
      };
    });
  }, []);

  const applyPanelValue = useCallback((loaded: DashboardPanelValue): void => {
    switch (loaded.panel) {
      case 'stats':
        if (loaded.value !== null) setStats(loaded.value);
        break;
      case 'citations':
        if (loaded.value !== null) setCitations(loaded.value);
        break;
      case 'searches':
        if (loaded.value !== null) {
          setSearches(loaded.value.searches);
          setSearchesNextToken(loaded.value.nextToken);
        }
        break;
      case 'keywords':
        setKeywords(loaded.value);
        break;
    }
  }, []);

  /**
   * Loads one panel and records its outcome. Never rejects. A keyword result
   * is dropped when a newer keyword read (reconciliation, retry) started.
   */
  const settlePanel = useCallback(async (
    panel: DashboardPanel,
    signal: AbortSignal,
    isCurrent: () => boolean,
    keywordGeneration: number
  ): Promise<void> => {
    const ownsPanel = () => isCurrent()
      && (panel !== 'keywords' || keywordGenerationRef.current === keywordGeneration);
    try {
      const loaded = await loadDashboardPanel(panel, signal);
      if (!ownsPanel()) return;
      applyPanelValue(loaded);
      setPanel(panel, () => IDLE_PANEL);
    } catch (panelError) {
      if (isAbortError(panelError) || !ownsPanel()) return;
      console.error(`[dashboard] Error fetching ${panel}:`, panelError);
      setPanel(panel, () => ({
        error: getErrorMessage(panelError),
        retrying: false,
      }));
    }
  }, [applyPanelValue, setPanel]);

  const abortPanelRetries = useCallback((): void => {
    Object.values(panelControllersRef.current).forEach((controller) => controller.abort());
    panelControllersRef.current = {};
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
    abortPanelRetries();

    const dashboardController = new AbortController();
    dashboardControllerRef.current = dashboardController;
    const { signal } = dashboardController;
    const isCurrent = () => ownerMountedRef.current
      && dashboardGenerationRef.current === dashboardGeneration;

    try {
      setLoading(true);
      validateApiConfig();
      setError(null);

      await Promise.allSettled(
        DASHBOARD_PANELS.map(async (panel) => settlePanel(panel, signal, isCurrent, keywordGeneration))
      );
      if (isCurrent()) setLastUpdate(new Date());
    } catch (configError) {
      if (!isCurrent()) return;
      setError(getErrorMessage(configError, 'dashboard'));
      console.error('[dashboard] API configuration error:', configError);
    } finally {
      if (dashboardControllerRef.current === dashboardController) {
        dashboardControllerRef.current = null;
      }
      if (isCurrent()) {
        setLoading(false);
      }
    }
  }, [abortPanelRetries, settlePanel]);

  /** Reloads one failed panel; the other panels keep their data. */
  const retryPanel = useCallback(async (panel: DashboardPanel): Promise<void> => {
    if (!ownerMountedRef.current) return;

    if (panel === 'keywords') {
      keywordGenerationRef.current += 1;
      keywordControllerRef.current?.abort();
      keywordControllerRef.current = null;
    }
    const dashboardGeneration = dashboardGenerationRef.current;
    const keywordGeneration = keywordGenerationRef.current;

    panelControllersRef.current[panel]?.abort();
    const controller = new AbortController();
    panelControllersRef.current[panel] = controller;
    const isCurrent = () => ownerMountedRef.current
      && dashboardGenerationRef.current === dashboardGeneration
      && panelControllersRef.current[panel] === controller;

    setPanel(panel, (previous) => ({
      ...previous,
      retrying: true,
    }));
    try {
      await settlePanel(panel, controller.signal, isCurrent, keywordGeneration);
    } finally {
      if (isCurrent()) {
        delete panelControllersRef.current[panel];
        // A superseded keyword retry recorded nothing; stop showing it as running.
        setPanel(panel, (previous) => (previous.retrying ? {
          ...previous,
          retrying: false,
        } : previous));
      }
    }
  }, [setPanel, settlePanel]);

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
      setPanel('keywords', () => IDLE_PANEL);
    } catch (reconciliationError) {
      if (!isAbortError(reconciliationError) && isCurrent()) {
        console.error('[keywords] Error reconciling active keywords:', reconciliationError);
      }
    } finally {
      if (keywordControllerRef.current === keywordController) {
        keywordControllerRef.current = null;
      }
    }
  }, [setPanel]);

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
      abortPanelRetries();
    };
  }, [abortPanelRetries]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    stats,
    citations,
    searches,
    /** Token of the page after `searches` (`null` when it is the last one). */
    searchesNextToken,
    keywords,
    setKeywords,
    /** Per-panel load error and retry state. */
    panels,
    retryPanel,
    loading,
    /** Set only when the API is not configured; panel failures are in `panels`. */
    error,
    lastUpdate,
    refetch: fetchData,
    reconcileKeywords,
  };
};
