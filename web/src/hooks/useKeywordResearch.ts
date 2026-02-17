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

      // Async response — poll history until result appears
      if (typeof data === 'object' && data !== null && 'status' in data && (data as Record<string, unknown>).status === 'pending') {
        const researchId = (data as Record<string, unknown>).id as string;
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 3000));
          try {
            const historyResp = await authenticatedFetch(`${API_BASE_URL}/keyword-research/history?type=expansion&limit=50`);
            if (historyResp.ok) {
              const historyData: unknown = await historyResp.json();
              if (isHistoryResponse(historyData)) {
                const completed = (historyData.items ?? []).find(
                  (item: KeywordResearchItem) => item.id === researchId && item.status === 'completed'
                );
                if (completed) {
                  setExpansionResult({
                    id: completed.id,
                    seed_keyword: completed.seed_keyword ?? seedKeyword,
                    industry: completed.industry ?? industry,
                    keywords: completed.keywords ?? [],
                    keyword_count: completed.keyword_count ?? 0,
                  });
                  return;
                }
                const failed = (historyData.items ?? []).find(
                  (item: KeywordResearchItem) => item.id === researchId && item.status === 'failed'
                );
                if (failed) {
                  throw new KeywordResearchError(failed.error_message ?? 'Expansion failed');
                }
              }
            }
          } catch (pollErr) {
            if (pollErr instanceof KeywordResearchError) throw pollErr;
          }
        }
        throw new KeywordResearchError('Expansion timed out. Check history for results.');
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
      
      // Async response — poll history until result appears
      if (typeof data === 'object' && data !== null && 'status' in data && (data as Record<string, unknown>).status === 'pending') {
        const researchId = (data as Record<string, unknown>).id as string;
        // Poll every 3 seconds for up to 2 minutes
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 3000));
          try {
            const historyResp = await authenticatedFetch(`${API_BASE_URL}/keyword-research/history?type=competitor&limit=50`);
            if (historyResp.ok) {
              const historyData: unknown = await historyResp.json();
              if (isHistoryResponse(historyData)) {
                const completed = (historyData.items ?? []).find(
                  (item: KeywordResearchItem) => item.id === researchId && item.status === 'completed'
                );
                if (completed?.analysis) {
                  setCompetitorResult({
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
                  });
                  return;
                }
                const failed = (historyData.items ?? []).find(
                  (item: KeywordResearchItem) => item.id === researchId && item.status === 'failed'
                );
                if (failed) {
                  throw new KeywordResearchError(failed.error_message ?? 'Analysis failed');
                }
              }
            }
          } catch (pollErr) {
            if (pollErr instanceof KeywordResearchError) throw pollErr;
            // Ignore transient poll errors, keep trying
          }
        }
        throw new KeywordResearchError('Analysis timed out. Check history for results.');
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
