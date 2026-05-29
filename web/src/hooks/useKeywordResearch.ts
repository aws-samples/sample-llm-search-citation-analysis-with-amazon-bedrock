import {
  useState, useCallback 
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

function isResearchItem(data: unknown): data is KeywordResearchItem {
  return typeof data === 'object' && data !== null && 'id' in data && 'status' in data;
}

function isPendingResponse(data: unknown): data is {
  id: string;
  status: 'pending';
} {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return record.status === 'pending' && typeof record.id === 'string';
}

const POLL_INTERVAL_MS = 2000;

const MAX_POLL_ATTEMPTS = 60;

type PollOutcome =
  | {
    kind: 'done';
    item: KeywordResearchItem;
  }
  | { kind: 'pending' };

/**
 * Read the research record once. Returns 'done' with the record when it has
 * reached a terminal completed state, 'pending' when it is not ready yet (or
 * the read was a transient non-OK), and throws KeywordResearchError when the
 * backend reports the work failed.
 */
async function readResearchStatus(researchId: string): Promise<PollOutcome> {
  const response = await authenticatedFetch(
    `${API_BASE_URL}/keyword-research/status/${researchId}`
  );

  // 404 = record not visible yet; other non-OK = transient. Keep polling.
  if (!response.ok) return { kind: 'pending' };

  const item: unknown = await response.json();
  if (!isResearchItem(item)) return { kind: 'pending' };

  if (item.status === 'completed') {
    return {
      kind: 'done',
      item
    };
  }
  if (item.status === 'failed') {
    throw new KeywordResearchError(item.error_message ?? 'Research failed');
  }
  return { kind: 'pending' };
}

/**
 * Poll the point-lookup status endpoint until the research record reaches a
 * terminal state.
 *
 * Uses GET /keyword-research/status/{id} (an O(1) DynamoDB get_item) instead of
 * scanning /history. The history scan applied its `Limit` before the type
 * filter, so once the table grew past one scan page the just-created record was
 * frequently absent from the response and polling silently hung until timeout.
 * The point lookup is both faster per poll and always finds the record.
 */
async function pollResearchStatus(
  researchId: string,
  attemptsLeft: number = MAX_POLL_ATTEMPTS
): Promise<KeywordResearchItem> {
  if (attemptsLeft <= 0) {
    throw new KeywordResearchError('Request timed out. Check History for results.');
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

  try {
    const outcome = await readResearchStatus(researchId);
    if (outcome.kind === 'done') return outcome.item;
  } catch (pollErr) {
    if (pollErr instanceof KeywordResearchError) throw pollErr;
    // Transient network error — fall through and retry.
  }

  return pollResearchStatus(researchId, attemptsLeft - 1);
}

export const useKeywordResearch = () => {
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expansionResult, setExpansionResult] = useState<KeywordExpansionResult | null>(null);
  const [competitorResult, setCompetitorResult] = useState<CompetitorAnalysisResult | null>(null);
  const [history, setHistory] = useState<KeywordResearchItem[]>([]);

  const expandKeywords = useCallback(async (seedKeyword: string, industry: string, count: number) => {
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
        const errorData: unknown = await response.json().catch(() => ({}));
        const errorMsg = isErrorResponse(errorData) 
          ? errorData.error ?? `HTTP ${response.status}` 
          : `HTTP ${response.status}`;
        throw new KeywordResearchError(errorMsg);
      }

      const data: unknown = await response.json();

      // Async response — poll status endpoint until result appears
      if (isPendingResponse(data)) {
        const completed = await pollResearchStatus(data.id);
        setExpansionResult({
          id: completed.id,
          seed_keyword: completed.seed_keyword ?? seedKeyword,
          industry: completed.industry ?? industry,
          keywords: completed.keywords ?? [],
          keyword_count: completed.keyword_count ?? 0,
        });
        return;
      }

      // Sync response (fallback)
      if (isKeywordExpansionResult(data)) {
        setExpansionResult(data);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'research'));
      console.error('[research] Error expanding keywords:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const analyzeCompetitor = useCallback(async (url: string) => {
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
        const errorData: unknown = await response.json().catch(() => ({}));
        const errorMsg = isErrorResponse(errorData) 
          ? errorData.error ?? `HTTP ${response.status}` 
          : `HTTP ${response.status}`;
        throw new KeywordResearchError(errorMsg);
      }

      const data: unknown = await response.json();
      
      // Async response — poll status endpoint until result appears
      if (isPendingResponse(data)) {
        const completed = await pollResearchStatus(data.id);
        if (!completed.analysis) {
          throw new KeywordResearchError('Analysis completed but returned no data');
        }
        setCompetitorResult({
          id: completed.id,
          url: completed.url ?? url,
          domain: completed.domain ?? '',
          provider: completed.provider ?? '',
          keyword_count: completed.keyword_count ?? 0,
          industry: completed.analysis.industry ?? completed.industry ?? '',
          primary_keywords: completed.analysis.primary_keywords ?? [],
          secondary_keywords: completed.analysis.secondary_keywords ?? [],
          longtail_keywords: completed.analysis.longtail_keywords ?? [],
          content_gaps: completed.analysis.content_gaps ?? [],
        });
        return;
      }

      // Sync response (fallback)
      if (isCompetitorAnalysisResult(data)) {
        setCompetitorResult(data);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'research'));
      console.error('[research] Error analyzing competitor:', err);
    } finally {
      setLoading(false);
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
