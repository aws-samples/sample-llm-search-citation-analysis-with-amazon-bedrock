import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  deleteGeneratedContent,
  fetchContentHistory as requestContentHistory,
  fetchContentIdeas as requestContentIdeas,
  fetchContentStatus,
  markContentViewed,
  startContentBriefBatch,
  startContentGeneration,
} from '../api/contentStudio';
import {
  getErrorMessage, isDefinitiveClientRejection
} from '../infrastructure';
import type {
  ContentBriefBatchRequest,
  ContentBriefBatchStartResponse,
  ContentGenerationIdea,
  ContentIdea,
  ContentStatus,
  ContentStudioHistory,
  GenerateContentResponse,
} from '../types';
import { useContentStudioBatchTracking } from './useContentStudioBatchTracking';

const GENERATING_POLL_INTERVAL = 10000;
const MAX_CONSECUTIVE_STATUS_FAILURES = 3;
const STATUS_POLLING_ERROR = 'Unable to check content generation status after 3 attempts. Refresh to try again.';

function isIndependentlyGenerating(item: ContentStudioHistory): boolean {
  return item.batch_id === undefined
    && (item.status === 'pending' || item.status === 'generating');
}

function isPollableItem(
  item: ContentStudioHistory,
  failureCounts: ReadonlyMap<string, number>
): boolean {
  return isIndependentlyGenerating(item)
    && (failureCounts.get(item.id) ?? 0) < MAX_CONSECUTIVE_STATUS_FAILURES;
}

function isStructuredBatchRejection(requestError: unknown): boolean {
  return isDefinitiveClientRejection(requestError)
    && requestError.responseMessage !== undefined;
}

export function useContentStudio() {
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [history, setHistory] = useState<ContentStudioHistory[]>([]);
  const [unviewedCount, setUnviewedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const itemPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestIdeasReadRef = useRef<symbol | null>(null);
  const latestHistoryReadRef = useRef<symbol | null>(null);
  const historyRequestRef = useRef<AbortController | null>(null);
  const latestGenerationRef = useRef<symbol | null>(null);
  const itemStatusPollRef = useRef<AbortController | null>(null);
  const pollingFailureCountsRef = useRef(new Map<string, number>());
  const loadingOperationsRef = useRef(new Set<symbol>());
  const generationOperationsRef = useRef(new Set<symbol>());
  // Stryker disable next-line BooleanLiteral: The setup effect establishes mounted state before consumer effects or events can start work.
  const mountedRef = useRef(false);

  // Stryker disable ArrayDeclaration: This mount lifecycle intentionally runs once per setup and cleanup cycle.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Stryker disable next-line BooleanLiteral: Cleanup and StrictMode setup are synchronous; operation tokens are the observable stale-work guard.
      mountedRef.current = false;
      latestIdeasReadRef.current = null;
      latestHistoryReadRef.current = null;
      historyRequestRef.current?.abort();
      historyRequestRef.current = null;
      latestGenerationRef.current = null;
      loadingOperationsRef.current.clear();
      generationOperationsRef.current.clear();
    };
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This callback closes only over stable refs and React state setters.
  const beginLoading = useCallback((): symbol => {
    const operation = Symbol();
    loadingOperationsRef.current.add(operation);
    setLoading(true);
    return operation;
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This callback closes only over stable refs and React state setters.
  const finishLoading = useCallback((operation: symbol): void => {
    loadingOperationsRef.current.delete(operation);
    // Stryker disable next-line ConditionalExpression: React discards state updates after real unmount; StrictMode stale work is token-gated.
    if (mountedRef.current) setLoading(loadingOperationsRef.current.size > 0);
  }, []);
  // Stryker restore ArrayDeclaration

  const fetchHistory = useCallback(async (
    limit = 20
  ): Promise<ContentStudioHistory[]> => {
    historyRequestRef.current?.abort();
    const controller = new AbortController();
    historyRequestRef.current = controller;
    const operation = beginLoading();
    latestHistoryReadRef.current = operation;
    setError(null);
    try {
      const response = await requestContentHistory(limit, controller.signal);
      if (!mountedRef.current || latestHistoryReadRef.current !== operation) return [];
      setHistory(response.history);
      setUnviewedCount(response.unviewedCount);
      return response.history;
    } catch (requestError) {
      if (!mountedRef.current || latestHistoryReadRef.current !== operation) return [];
      setError(getErrorMessage(requestError, 'content'));
      console.error('[content] Error fetching history:', requestError);
      return [];
    } finally {
      if (historyRequestRef.current === controller) historyRequestRef.current = null;
      finishLoading(operation);
    }
  }, [beginLoading, finishLoading]);

  const {
    activeBatches,
    registerBatchCandidate,
    discardBatchCandidate,
    trackBatchStart,
  } = useContentStudioBatchTracking(fetchHistory, mountedRef);

  const recordStatusFailure = useCallback((contentId: string, caughtError: unknown) => {
    const previousFailures = pollingFailureCountsRef.current.get(contentId) ?? 0;
    const failureCount = Math.min(
      previousFailures + 1,
      MAX_CONSECUTIVE_STATUS_FAILURES
    );
    pollingFailureCountsRef.current.set(contentId, failureCount);
    if (failureCount !== MAX_CONSECUTIVE_STATUS_FAILURES) return;

    setPollingError(STATUS_POLLING_ERROR);
    console.error('[content] Status polling stopped for an item after repeated failures:', {
      contentId,
      failureCount,
      caughtError,
    });
  }, []);

  const processStatusResults = useCallback((
    generatingItems: readonly ContentStudioHistory[],
    statusResults: readonly PromiseSettledResult<ContentStatus>[]
  ): boolean => {
    const terminalStatuses = new Map<string, ContentStatus>();
    statusResults.forEach((statusResult, index) => {
      const generatingItem = generatingItems[index];
      if ('reason' in statusResult) {
        recordStatusFailure(generatingItem.id, statusResult.reason);
        return;
      }
      pollingFailureCountsRef.current.delete(generatingItem.id);
      const statusChanged = statusResult.value !== generatingItem.status;
      const terminal = statusResult.value === 'generated' || statusResult.value === 'failed';
      if (statusChanged && terminal) terminalStatuses.set(generatingItem.id, statusResult.value);
    });
    if (terminalStatuses.size === 0) return false;

    setHistory((current) => current.map((historyItem) => {
      const terminalStatus = terminalStatuses.get(historyItem.id);
      return terminalStatus !== undefined && isIndependentlyGenerating(historyItem)
        ? {
          ...historyItem,
          status: terminalStatus,
        }
        : historyItem;
    }));
    return true;
  }, [recordStatusFailure]);

  const stopItemPolling = useCallback(() => {
    const itemStatusPoll = itemStatusPollRef.current;
    itemStatusPollRef.current = null;
    itemStatusPoll?.abort();
    if (itemPollingRef.current !== null) {
      clearInterval(itemPollingRef.current);
      itemPollingRef.current = null;
    }
  }, []);

  const pollGeneratingItems = useCallback(async () => {
    if (itemStatusPollRef.current !== null) return;
    const generatingItems = history.filter((item) => (
      isPollableItem(item, pollingFailureCountsRef.current)
    ));
    if (generatingItems.length === 0) {
      stopItemPolling();
      return;
    }

    const itemStatusPoll = new AbortController();
    itemStatusPollRef.current = itemStatusPoll;
    try {
      const statusResults = await Promise.allSettled(generatingItems.map((item) => (
        fetchContentStatus(item.id, itemStatusPoll.signal)
      )));
      if (itemStatusPollRef.current !== itemStatusPoll) return;
      const hasTerminalTransition = processStatusResults(generatingItems, statusResults);
      if (hasTerminalTransition) await fetchHistory();
      const hasPollableItems = history.some((item) => (
        isPollableItem(item, pollingFailureCountsRef.current)
      ));
      if (itemStatusPollRef.current === itemStatusPoll && !hasPollableItems) stopItemPolling();
    } finally {
      if (itemStatusPollRef.current === itemStatusPoll) itemStatusPollRef.current = null;
    }
  }, [fetchHistory, history, processStatusResults, stopItemPolling]);

  const startItemPolling = useCallback(() => {
    if (itemPollingRef.current !== null) return;
    const hasPollableItems = history.some((item) => (
      isPollableItem(item, pollingFailureCountsRef.current)
    ));
    if (!hasPollableItems) return;

    itemPollingRef.current = setInterval(
      () => void pollGeneratingItems(),
      GENERATING_POLL_INTERVAL
    );
    void pollGeneratingItems();
  }, [history, pollGeneratingItems]);

  useEffect(() => {
    const activeIds = new Set(history.filter(isIndependentlyGenerating).map((item) => item.id));
    for (const contentId of pollingFailureCountsRef.current.keys()) {
      if (!activeIds.has(contentId)) pollingFailureCountsRef.current.delete(contentId);
    }
    const hasExhaustedItem = [...pollingFailureCountsRef.current.values()]
      .some((failureCount) => failureCount >= MAX_CONSECUTIVE_STATUS_FAILURES);
    if (!hasExhaustedItem) setPollingError(null);
    startItemPolling();
    return stopItemPolling;
  }, [history, startItemPolling, stopItemPolling]);

  const fetchIdeas = useCallback(async (): Promise<ContentIdea[]> => {
    const operation = beginLoading();
    latestIdeasReadRef.current = operation;
    setError(null);
    try {
      const response = await requestContentIdeas();
      if (!mountedRef.current || latestIdeasReadRef.current !== operation) return [];
      setIdeas(response);
      return response;
    } catch (requestError) {
      if (!mountedRef.current || latestIdeasReadRef.current !== operation) return [];
      setError(getErrorMessage(requestError, 'content'));
      console.error('[content] Error fetching ideas:', requestError);
      return [];
    } finally {
      finishLoading(operation);
    }
  }, [beginLoading, finishLoading]);

  // Stryker disable ArrayDeclaration: This callback closes only over stable refs and React state setters.
  const beginGeneration = useCallback((): symbol => {
    const operation = Symbol();
    generationOperationsRef.current.add(operation);
    latestGenerationRef.current = operation;
    setGenerating(true);
    setError(null);
    return operation;
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This callback closes only over stable refs and React state setters.
  const finishGeneration = useCallback((operation: symbol): void => {
    generationOperationsRef.current.delete(operation);
    // Stryker disable next-line ConditionalExpression: React discards state updates after real unmount; StrictMode stale work is token-gated.
    if (mountedRef.current) setGenerating(generationOperationsRef.current.size > 0);
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This callback reads only stable refs.
  const generationCanReport = useCallback((operation: symbol): boolean => (
    mountedRef.current && latestGenerationRef.current === operation
  ), []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: All dependencies have stable callback identities proven by lifecycle race tests.
  const generateContent = useCallback(async (
    idea: ContentGenerationIdea
  ): Promise<GenerateContentResponse | null> => {
    const operation = beginGeneration();
    try {
      return await startContentGeneration(idea);
    } catch (requestError) {
      if (generationCanReport(operation)) {
        setError(getErrorMessage(requestError, 'content'));
      }
      console.error('[content] Error starting content generation:', requestError);
      return null;
    } finally {
      finishGeneration(operation);
    }
  }, [beginGeneration, finishGeneration, generationCanReport]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: Every dependency is a stable hook callback or ref-backed lifecycle function.
  const generateContentBatch = useCallback(async (
    request: ContentBriefBatchRequest
  ): Promise<ContentBriefBatchStartResponse | null> => {
    const operation = beginGeneration();
    const candidate = registerBatchCandidate(request.batch_id);
    try {
      const response = await startContentBriefBatch(request);
      if (!response.success) {
        discardBatchCandidate(candidate);
        if (response.error !== undefined && generationCanReport(operation)) {
          setError(response.error);
        }
        return response;
      }
      if (!mountedRef.current || !generationOperationsRef.current.has(operation)) {
        return response;
      }
      trackBatchStart(response, candidate);
      return response;
    } catch (requestError) {
      if (isStructuredBatchRejection(requestError)) {
        discardBatchCandidate(candidate);
      }
      if (generationCanReport(operation)) {
        setError(getErrorMessage(requestError, 'content'));
      }
      console.error('[content] Error starting Content Brief batch:', requestError);
      return null;
    } finally {
      finishGeneration(operation);
    }
  }, [
    beginGeneration,
    discardBatchCandidate,
    finishGeneration,
    generationCanReport,
    registerBatchCandidate,
    trackBatchStart,
  ]);
  // Stryker restore ArrayDeclaration

  const markViewed = useCallback(async (id: string): Promise<boolean> => {
    try {
      await markContentViewed(id);
      if (!mountedRef.current) return true;
      setHistory((current) => current.map((item) => (
        item.id === id ? {
          ...item,
          viewed: true,
        } : item
      )));
      setUnviewedCount((current) => Math.max(0, current - 1));
      return true;
    } catch (requestError) {
      console.error('[content] Error marking content as viewed:', requestError);
      return false;
    }
  }, []);

  const deleteContent = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteGeneratedContent(id);
      if (!mountedRef.current) return true;
      const deletedItem = history.find((item) => item.id === id);
      setHistory((current) => current.filter((item) => item.id !== id));
      if (deletedItem !== undefined && !deletedItem.viewed) {
        setUnviewedCount((current) => Math.max(0, current - 1));
      }
      return true;
    } catch (requestError) {
      if (mountedRef.current) setError(getErrorMessage(requestError, 'content'));
      console.error('[content] Error deleting content:', requestError);
      return false;
    }
  }, [history]);

  const refreshGeneratingItems = useCallback(() => {
    stopItemPolling();
    pollingFailureCountsRef.current.clear();
    if (!mountedRef.current) return;
    setError(null);
    setPollingError(null);
    startItemPolling();
  }, [startItemPolling, stopItemPolling]);

  return {
    ideas,
    history,
    unviewedCount,
    loading,
    generating,
    error: pollingError ?? error,
    activeBatches,
    fetchIdeas,
    generateContent,
    generateContentBatch,
    fetchHistory,
    markViewed,
    deleteContent,
    refreshGeneratingItems,
  };
}
