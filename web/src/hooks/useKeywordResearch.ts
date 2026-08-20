import {
  useState, useCallback, useEffect, useRef 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, getErrorMessage 
} from '../infrastructure';
import type {
  KeywordExpansionResult, CompetitorAnalysisResult, KeywordResearchItem 
} from '../types';

class KeywordResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordResearchError';
  }
}

interface ErrorResponse {error?: string;}

interface HistoryResponse {items?: KeywordResearchItem[];}

function isErrorResponse(data: unknown): data is ErrorResponse {
  return typeof data === 'object' && data !== null;
}

function isHistoryResponse(data: unknown): data is HistoryResponse {
  return typeof data === 'object' && data !== null;
}

function isKeywordExpansionResult(data: unknown): data is KeywordExpansionResult {
  return typeof data === 'object' && data !== null && 'keywords' in data;
}

function isCompetitorAnalysisResult(data: unknown): data is CompetitorAnalysisResult {
  return typeof data === 'object' && data !== null && 'url' in data;
}

// Async research jobs are polled via the history endpoint every 3 seconds
// for up to 2 minutes.
const POLL_MAX_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readErrorMessage(response: Response): Promise<string> {
  const errorData: unknown = await response.json().catch(() => ({}));
  return isErrorResponse(errorData)
    ? errorData.error ?? `HTTP ${response.status}`
    : `HTTP ${response.status}`;
}

/** Extract the research id from an async "pending" API response. */
function getPendingResearchId(data: unknown): string | null {
  if (typeof data === 'object' && data !== null && 'status' in data) {
    const record = data as Record<string, unknown>;
    if (record.status === 'pending' && typeof record.id === 'string') {
      return record.id;
    }
  }
  return null;
}

interface ResearchPollOptions {
  type: 'expansion' | 'competitor';
  researchId: string;
  failureMessage: string;
  timeoutMessage: string;
  /** Extra completion predicate beyond status === 'completed'. */
  isComplete?: (item: KeywordResearchItem) => boolean;
}

/**
 * One poll attempt against the research history. Returns the completed item,
 * null when it is not ready yet (including transient poll errors), and throws
 * when the research job reports failure.
 */
async function findResearchItem(options: ResearchPollOptions): Promise<KeywordResearchItem | null> {
  try {
    const historyResp = await authenticatedFetch(
      `${API_BASE_URL}/keyword-research/history?type=${options.type}&limit=50`
    );
    // Auth failures are fatal, not "not ready yet". Without this check an
    // expired session kept polling for the full 2 minutes and then reported
    // a bogus timeout (AUDIT 2.20).
    if (historyResp.status === 401 || historyResp.status === 403) {
      // Worded to categorize as 'auth' in getErrorMessage, so the UI shows
      // the research auth message instead of a generic failure.
      throw new KeywordResearchError(
        `Unauthorized (${historyResp.status}): session expired while waiting for results. Sign in again, then check History.`
      );
    }
    if (!historyResp.ok) return null;
    const historyData: unknown = await historyResp.json();
    if (!isHistoryResponse(historyData)) return null;

    const items = historyData.items ?? [];
    const completed = items.find(
      (item) => item.id === options.researchId && item.status === 'completed'
    );
    if (completed && (options.isComplete?.(completed) ?? true)) {
      return completed;
    }

    const failed = items.find(
      (item) => item.id === options.researchId && item.status === 'failed'
    );
    if (failed) {
      throw new KeywordResearchError(failed.error_message ?? options.failureMessage);
    }
    return null;
  } catch (pollErr) {
    if (pollErr instanceof KeywordResearchError) throw pollErr;
    // Ignore transient poll errors, keep trying
    return null;
  }
}

/**
 * Poll the history endpoint until the research job completes, fails, or
 * times out. Returns null when `isCancelled` reports the poll was superseded
 * by a newer call or the component unmounted — previously polling ran to the
 * full 2 minutes with no cancellation path at all (AUDIT 2.20).
 */
async function pollUntilComplete(
  options: ResearchPollOptions,
  isCancelled: () => boolean,
  attemptsLeft: number = POLL_MAX_ATTEMPTS
): Promise<KeywordResearchItem | null> {
  if (attemptsLeft === 0) {
    throw new KeywordResearchError(options.timeoutMessage);
  }
  await sleep(POLL_INTERVAL_MS);
  if (isCancelled()) return null;
  const completed = await findResearchItem(options);
  if (isCancelled()) return null;
  if (completed) return completed;
  return pollUntilComplete(options, isCancelled, attemptsLeft - 1);
}

function toExpansionResult(
  completed: KeywordResearchItem,
  seedKeyword: string,
  industry: string
): KeywordExpansionResult {
  return {
    id: completed.id,
    seed_keyword: completed.seed_keyword ?? seedKeyword,
    industry: completed.industry ?? industry,
    keywords: completed.keywords ?? [],
    keyword_count: completed.keyword_count ?? 0,
  };
}

function toCompetitorResult(completed: KeywordResearchItem, url: string): CompetitorAnalysisResult {
  return {
    id: completed.id,
    url: completed.url ?? url,
    domain: completed.domain ?? '',
    provider: completed.provider ?? '',
    keyword_count: completed.keyword_count ?? 0,
    industry: completed.analysis?.industry ?? completed.industry ?? '',
    primary_keywords: completed.analysis?.primary_keywords ?? [],
    secondary_keywords: completed.analysis?.secondary_keywords ?? [],
    longtail_keywords: completed.analysis?.longtail_keywords ?? [],
    content_gaps: completed.analysis?.content_gaps ?? [],
  };
}

export const useKeywordResearch = () => {
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expansionResult, setExpansionResult] = useState<KeywordExpansionResult | null>(null);
  const [competitorResult, setCompetitorResult] = useState<CompetitorAnalysisResult | null>(null);
  const [history, setHistory] = useState<KeywordResearchItem[]>([]);

  // Cancellation for the long-running poll loops (AUDIT 2.20): each
  // expand/analyze call claims a new generation; a later call or unmount
  // invalidates older generations, stopping their polls at the next tick
  // and dropping their stale state updates.
  const pollGenerationRef = useRef(0);

  useEffect(() => () => {
    pollGenerationRef.current += 1;
  }, []);

  const expandKeywords = useCallback(async (seedKeyword: string, industry: string, count: number) => {
    const generation = ++pollGenerationRef.current;
    const isCancelled = () => pollGenerationRef.current !== generation;

    setLoading(true);
    setError(null);
    setExpansionResult(null);

    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/keyword-research/expand`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json',},
        body: JSON.stringify({
          seed_keyword: seedKeyword,
          industry,
          count,
        }),
      });

      if (!response.ok) {
        throw new KeywordResearchError(await readErrorMessage(response));
      }

      const data: unknown = await response.json();

      // Async response — poll history until result appears
      const pendingId = getPendingResearchId(data);
      if (pendingId) {
        const completed = await pollUntilComplete({
          type: 'expansion',
          researchId: pendingId,
          failureMessage: 'Expansion failed',
          timeoutMessage: 'Expansion timed out. Check history for results.',
        }, isCancelled);
        // null means the poll was superseded or unmounted — drop silently.
        if (!completed) return;
        setExpansionResult(toExpansionResult(completed, seedKeyword, industry));
        return;
      }

      // Sync response (fallback)
      if (isCancelled()) return;
      if (isKeywordExpansionResult(data)) {
        setExpansionResult(data);
      }
    } catch (err) {
      // A superseded call must not overwrite the newer call's error state.
      if (isCancelled()) return;
      setError(getErrorMessage(err, 'research'));
      console.error('[research] Error expanding keywords:', err);
    } finally {
      // Only the current generation may clear loading; a superseded call
      // finishing late would otherwise flip off the newer call's spinner.
      if (!isCancelled()) {
        setLoading(false);
      }
    }
  }, []);

  const analyzeCompetitor = useCallback(async (url: string) => {
    const generation = ++pollGenerationRef.current;
    const isCancelled = () => pollGenerationRef.current !== generation;

    setLoading(true);
    setError(null);
    setCompetitorResult(null);

    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/keyword-research/competitor`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json',},
        body: JSON.stringify({url,}),
      });

      if (!response.ok) {
        throw new KeywordResearchError(await readErrorMessage(response));
      }

      const data: unknown = await response.json();

      // Async response — poll history until result appears
      const pendingId = getPendingResearchId(data);
      if (pendingId) {
        const completed = await pollUntilComplete({
          type: 'competitor',
          researchId: pendingId,
          failureMessage: 'Analysis failed',
          timeoutMessage: 'Analysis timed out. Check history for results.',
          isComplete: (item) => Boolean(item.analysis),
        }, isCancelled);
        // null means the poll was superseded or unmounted — drop silently.
        if (!completed) return;
        setCompetitorResult(toCompetitorResult(completed, url));
        return;
      }

      // Sync response (fallback)
      if (isCancelled()) return;
      if (isCompetitorAnalysisResult(data)) {
        setCompetitorResult(data);
      }
    } catch (err) {
      // A superseded call must not overwrite the newer call's error state.
      if (isCancelled()) return;
      setError(getErrorMessage(err, 'research'));
      console.error('[research] Error analyzing competitor:', err);
    } finally {
      // Only the current generation may clear loading; a superseded call
      // finishing late would otherwise flip off the newer call's spinner.
      if (!isCancelled()) {
        setLoading(false);
      }
    }
  }, []);

  const fetchHistory = useCallback(async (type?: 'expansion' | 'competitor') => {
    setHistoryLoading(true);

    try {
      const params = new URLSearchParams();
      if (type) params.append('type', type);
      params.append('limit', '50');

      const response = await authenticatedFetch(`${API_BASE_URL}/keyword-research/history?${params}`);
      if (!response.ok) {
        throw new KeywordResearchError(`HTTP ${response.status}`);
      }

      const data: unknown = await response.json();
      if (isHistoryResponse(data)) {
        setHistory(data.items ?? []);
      }
    } catch (err) {
      console.error('[research] Error fetching history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const deleteResearch = useCallback(async (id: string) => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/keyword-research/${id}`, {method: 'DELETE',});
      if (!response.ok) {
        throw new KeywordResearchError(`HTTP ${response.status}`);
      }
      setHistory((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error('[research] Error deleting research:', err);
    }
  }, []);

  return {
    loading,
    historyLoading,
    error,
    expansionResult,
    competitorResult,
    history,
    expandKeywords,
    analyzeCompetitor,
    fetchHistory,
    deleteResearch,
  };
};
