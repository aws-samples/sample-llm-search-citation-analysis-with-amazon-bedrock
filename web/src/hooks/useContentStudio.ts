import {
  useState, useCallback, useEffect, useRef
} from 'react';
import {
  API_BASE_URL,
  authenticatedFetch,
  getErrorMessage,
  ApiRequestError,
} from '../infrastructure';
import type {
  ContentIdea, ContentStudioHistory, ContentStatus
} from '../types';

const GENERATING_POLL_INTERVAL = 10000;
const MAX_CONSECUTIVE_STATUS_FAILURES = 3;
const STATUS_POLLING_ERROR = 'Unable to check content generation status after 3 attempts. Refresh to try again.';

type GenerateContentResponse = Pick<ContentStudioHistory, 'id' | 'status' | 'keyword'> & {
  success: boolean;
  error?: string;
};

interface ContentHistoryResponse {
  history: ContentStudioHistory[];
  unviewed_count: number;
}

type ContentStatusResponse = Pick<ContentStudioHistory, 'id' | 'status'>;

interface PollingOwner {
  readonly token: symbol;
  readonly controller: AbortController;
  inFlight: boolean;
  historyRefreshInFlight: boolean;
}

interface HistoryRequestOwner {
  readonly controller: AbortController;
  readonly pollingToken: symbol | undefined;
}

function isContentIdeasResponse(data: unknown): data is { ideas: ContentIdea[] } { return typeof data === 'object' && data !== null && 'ideas' in data; }

function isGenerateContentResponse(data: unknown): data is GenerateContentResponse { return typeof data === 'object' && data !== null && 'id' in data && 'status' in data; }

function isContentHistoryResponse(data: unknown): data is ContentHistoryResponse { return typeof data === 'object' && data !== null && 'history' in data; }

function isContentStatus(value: unknown): value is ContentStatus { return value === 'pending' || value === 'generating' || value === 'generated' || value === 'failed'; }

function isContentStatusResponse(data: unknown): data is ContentStatusResponse { return typeof data === 'object' && data !== null && 'id' in data && 'status' in data && typeof data.id === 'string' && isContentStatus(data.status); }

function isGeneratingItem(item: ContentStudioHistory): boolean {
  return item.status === 'pending' || item.status === 'generating';
}

function isPollableItem(
  item: ContentStudioHistory,
  failureCounts: ReadonlyMap<string, number>
): boolean {
  return isGeneratingItem(item)
    && (failureCounts.get(item.id) ?? 0) < MAX_CONSECUTIVE_STATUS_FAILURES;
}

export function useContentStudio() {
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [history, setHistory] = useState<ContentStudioHistory[]>([]);
  const [unviewedCount, setUnviewedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const historyRef = useRef<ContentStudioHistory[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingOwnerRef = useRef<PollingOwner | null>(null);
  const historyRequestRef = useRef<HistoryRequestOwner | null>(null);
  const pollingFailureCountsRef = useRef(new Map<string, number>());
  const mountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    const pollingOwner = pollingOwnerRef.current;
    pollingOwnerRef.current = null;
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (pollingOwner === null) return;
    pollingOwner.controller.abort();

    const historyRequest = historyRequestRef.current;
    if (historyRequest?.pollingToken === pollingOwner.token) {
      historyRequest.controller.abort();
      historyRequestRef.current = null;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
      historyRequestRef.current?.controller.abort();
      historyRequestRef.current = null;
    };
  }, [stopPolling]);

  const pollingCanCommit = useCallback((pollingOwner: PollingOwner): boolean => (
    mountedRef.current
    && pollingOwnerRef.current === pollingOwner
    && pollingOwner.controller.signal.aborted === false
  ), []);

  const historyRequestCanCommit = useCallback((requestOwner: HistoryRequestOwner): boolean => {
    const pollingRequestIsCurrent = requestOwner.pollingToken === undefined
      || pollingOwnerRef.current?.token === requestOwner.pollingToken;
    return mountedRef.current
      && historyRequestRef.current === requestOwner
      && requestOwner.controller.signal.aborted === false
      && pollingRequestIsCurrent;
  }, []);

  const checkContentStatus = useCallback(async (
    id: string,
    signal: AbortSignal
  ): Promise<ContentStatusResponse> => {
    const response = await authenticatedFetch(
      `${API_BASE_URL}/content-studio/status/${id}`,
      { signal }
    );
    if (!response.ok) {
      throw new ApiRequestError(`Status check failed with HTTP ${response.status}`, response.status);
    }

    const json: unknown = await response.json();
    if (!isContentStatusResponse(json) || json.id !== id) {
      throw new ApiRequestError('Invalid content status response');
    }
    return json;
  }, []);

  const fetchHistoryRequest = useCallback(async (
    limit: number,
    pollingToken?: symbol
  ): Promise<ContentStudioHistory[]> => {
    historyRequestRef.current?.controller.abort();
    const requestOwner: HistoryRequestOwner = {
      controller: new AbortController(),
      pollingToken,
    };
    historyRequestRef.current = requestOwner;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ limit: limit.toString() });
      const response = await authenticatedFetch(
        `${API_BASE_URL}/content-studio/history?${params}`,
        { signal: requestOwner.controller.signal }
      );
      if (!response.ok) throw new ApiRequestError(`HTTP ${response.status}`, response.status);

      const json: unknown = await response.json();
      if (!isContentHistoryResponse(json)) {
        throw new ApiRequestError('Invalid response format');
      }
      if (!historyRequestCanCommit(requestOwner)) return [];
      historyRef.current = json.history;
      setHistory(json.history);
      setUnviewedCount(json.unviewed_count);
      return json.history;
    } catch (caughtError) {
      if (!historyRequestCanCommit(requestOwner)) return [];
      setError(getErrorMessage(caughtError, 'content'));
      console.error('[content] Error fetching history:', caughtError);
      return [];
    } finally {
      if (historyRequestRef.current === requestOwner) {
        historyRequestRef.current = null;
        if (mountedRef.current) setLoading(false);
      }
    }
  }, [historyRequestCanCommit]);

  const fetchHistory = useCallback(async (limit = 20): Promise<ContentStudioHistory[]> => (
    fetchHistoryRequest(limit)
  ), [fetchHistoryRequest]);

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
    statusResults: readonly PromiseSettledResult<ContentStatusResponse>[]
  ): boolean => {
    const terminalResponses = statusResults.flatMap((statusResult, index) => {
      const generatingItem = generatingItems[index];
      if ('reason' in statusResult) {
        recordStatusFailure(generatingItem.id, statusResult.reason);
        return [];
      }
      pollingFailureCountsRef.current.delete(generatingItem.id);
      const statusChanged = statusResult.value.status !== generatingItem.status;
      const terminal = ['generated', 'failed'].includes(statusResult.value.status);
      return statusChanged && terminal ? [statusResult.value] : [];
    });
    if (terminalResponses.length === 0) return false;

    const currentHistory = historyRef.current;
    const updatedHistory = currentHistory.map((historyItem) => {
      const terminalResponse = terminalResponses.find(({ id }) => id === historyItem.id);
      return terminalResponse !== undefined && isGeneratingItem(historyItem)
        ? {
          ...historyItem,
          status: terminalResponse.status,
        }
        : historyItem;
    });
    if (updatedHistory.every((historyItem, index) => historyItem === currentHistory[index])) {
      return false;
    }
    historyRef.current = updatedHistory;
    setHistory(updatedHistory);
    return true;
  }, [recordStatusFailure]);

  const pollGeneratingItems = useCallback(async (pollingOwner: PollingOwner) => {
    if (!pollingCanCommit(pollingOwner) || pollingOwner.inFlight) return;
    const generatingItems = historyRef.current.filter((item) => (
      isPollableItem(item, pollingFailureCountsRef.current)
    ));
    if (generatingItems.length === 0) {
      stopPolling();
      return;
    }

    pollingOwner.inFlight = true;
    try {
      const statusResults = await Promise.allSettled(
        generatingItems.map((item) => (
          checkContentStatus(item.id, pollingOwner.controller.signal)
        ))
      );
      if (!pollingCanCommit(pollingOwner)) return;
      const hasTerminalTransition = processStatusResults(generatingItems, statusResults);
      if (hasTerminalTransition) {
        pollingOwner.historyRefreshInFlight = true;
        await fetchHistoryRequest(20, pollingOwner.token);
      }
      const hasPollableItems = historyRef.current.some((item) => (
        isPollableItem(item, pollingFailureCountsRef.current)
      ));
      if (pollingCanCommit(pollingOwner) && !hasPollableItems) stopPolling();
    } finally {
      pollingOwner.historyRefreshInFlight = false;
      pollingOwner.inFlight = false;
    }
  }, [
    checkContentStatus,
    fetchHistoryRequest,
    pollingCanCommit,
    processStatusResults,
    stopPolling,
  ]);

  const startPolling = useCallback(() => {
    if (!mountedRef.current || pollingOwnerRef.current !== null) return;
    const hasPollableItems = historyRef.current.some((item) => (
      isPollableItem(item, pollingFailureCountsRef.current)
    ));
    if (!hasPollableItems) return;

    const pollingOwner: PollingOwner = {
      token: Symbol(),
      controller: new AbortController(),
      inFlight: false,
      historyRefreshInFlight: false,
    };
    pollingOwnerRef.current = pollingOwner;
    pollingRef.current = setInterval(() => {
      void pollGeneratingItems(pollingOwner);
    }, GENERATING_POLL_INTERVAL);
    void pollGeneratingItems(pollingOwner);
  }, [pollGeneratingItems]);

  useEffect(() => {
    const activeIds = new Set(history.filter(isGeneratingItem).map((item) => item.id));
    for (const contentId of pollingFailureCountsRef.current.keys()) {
      if (!activeIds.has(contentId)) pollingFailureCountsRef.current.delete(contentId);
    }
    const hasExhaustedItem = [...pollingFailureCountsRef.current.values()]
      .some((failureCount) => failureCount >= MAX_CONSECUTIVE_STATUS_FAILURES);
    if (!hasExhaustedItem) setPollingError(null);
    if (activeIds.size === 0) {
      pollingFailureCountsRef.current.clear();
      if (pollingOwnerRef.current?.historyRefreshInFlight !== true) stopPolling();
      return;
    }
    startPolling();
  }, [history, startPolling, stopPolling]);

  const fetchIdeas = useCallback(async (): Promise<ContentIdea[]> => {
    setLoading(true);
    setError(null);

    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/content-studio/ideas`);
      if (!response.ok) throw new ApiRequestError('Failed to fetch content ideas', response.status);

      const json: unknown = await response.json();
      if (!isContentIdeasResponse(json)) {
        throw new ApiRequestError('Invalid response format');
      }
      setIdeas(json.ideas);
      return json.ideas;
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'content'));
      console.error('[content] Error fetching ideas:', caughtError);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const generateContent = useCallback(async (idea: ContentIdea): Promise<GenerateContentResponse | null> => {
    setGenerating(true);
    setError(null);

    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/content-studio/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea })
      });

      const json: unknown = await response.json();
      if (!isGenerateContentResponse(json)) {
        throw new ApiRequestError('Invalid response format');
      }
      if (!response.ok) {
        throw new ApiRequestError(json.error ?? `HTTP ${response.status}`, response.status);
      }

      await fetchHistory();
      return json;
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'content'));
      console.error('[content] Error generating content:', caughtError);
      return null;
    } finally {
      setGenerating(false);
    }
  }, [fetchHistory]);

  const markViewed = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/content-studio/viewed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (!response.ok) throw new ApiRequestError(`HTTP ${response.status}`, response.status);

      setHistory((previous) => {
        const updatedHistory = previous.map((item) => (
          item.id === id
            ? {
              ...item,
              viewed: true
            }
            : item
        ));
        historyRef.current = updatedHistory;
        return updatedHistory;
      });
      setUnviewedCount((previous) => Math.max(0, previous - 1));
      return true;
    } catch (caughtError) {
      console.error('[content] Error marking content as viewed:', caughtError);
      return false;
    }
  }, []);

  const deleteContent = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/content-studio/${id}`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new ApiRequestError(`HTTP ${response.status}`, response.status);

      const deletedItem = historyRef.current.find((item) => item.id === id);
      setHistory((previous) => {
        const updatedHistory = previous.filter((item) => item.id !== id);
        historyRef.current = updatedHistory;
        return updatedHistory;
      });
      if (deletedItem && !deletedItem.viewed) {
        setUnviewedCount((previous) => Math.max(0, previous - 1));
      }
      return true;
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'content'));
      console.error('[content] Error deleting content:', caughtError);
      return false;
    }
  }, []);

  const refreshGeneratingItems = useCallback(() => {
    stopPolling();
    pollingFailureCountsRef.current.clear();
    if (!mountedRef.current) return;
    setError(null);
    setPollingError(null);
    startPolling();
  }, [startPolling, stopPolling]);

  return {
    ideas,
    history,
    unviewedCount,
    loading,
    generating,
    error: pollingError ?? error,
    fetchIdeas,
    generateContent,
    fetchHistory,
    markViewed,
    deleteContent,
    refreshGeneratingItems
  };
}
