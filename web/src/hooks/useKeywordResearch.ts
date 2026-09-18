import {
  useState, useCallback, useEffect, useRef 
} from 'react';
import { getErrorMessage } from '../infrastructure';
import {
  deleteKeywordResearch,
  fetchKeywordResearchHistory,
  retryKeywordResearch,
  startCompetitorAnalysis,
  startKeywordExpansion,
} from '../api/keywordResearch';
import type { ResearchType } from '../api/keywordResearch';
import { pollResearchJob } from './researchPolling';
import type {
  KeywordExpansionResult, CompetitorAnalysisResult, KeywordResearchItem 
} from '../types';

/**
 * The job the user is waiting on, remembered across a refresh or a tab switch
 * so the view re-attaches to it instead of losing the run (R15).
 */
const ACTIVE_JOB_STORAGE_KEY = 'keywordResearch.activeJob';

interface StoredActiveJob {
  id: string;
  type: ResearchType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStoredActiveJob(value: unknown): value is StoredActiveJob {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.type === 'expansion' || value.type === 'competitor');
}

function readStoredActiveJob(): StoredActiveJob | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredActiveJob(parsed) ? {
      id: parsed.id,
      type: parsed.type 
    } : null;
  } catch {
    return null;
  }
}

function storeActiveJob(job: StoredActiveJob | null): void {
  try {
    if (job === null) {
      sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
    } else {
      sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify(job));
    }
  } catch {
    // Storage can be unavailable (private mode, quota); re-attach is best effort.
  }
}

function toExpansionResult(job: KeywordResearchItem): KeywordExpansionResult {
  return {
    id: job.id,
    seed_keyword: job.seed_keyword ?? '',
    industry: job.industry ?? 'general',
    keywords: job.keywords ?? [],
    keyword_count: job.keyword_count ?? 0,
  };
}

function toCompetitorResult(job: KeywordResearchItem): CompetitorAnalysisResult {
  return {
    id: job.id,
    url: job.url ?? '',
    domain: job.domain ?? '',
    provider: job.provider ?? '',
    keyword_count: job.keyword_count ?? 0,
    industry: job.analysis?.industry ?? job.industry ?? '',
    primary_keywords: job.analysis?.primary_keywords ?? [],
    secondary_keywords: job.analysis?.secondary_keywords ?? [],
    longtail_keywords: job.analysis?.longtail_keywords ?? [],
    content_gaps: job.analysis?.content_gaps ?? [],
  };
}

const TIMEOUT_MESSAGES: Record<ResearchType, string> = {
  expansion: 'Expansion is taking longer than expected. Check History for the result.',
  competitor: 'Analysis is taking longer than expected. Check History for the result.',
};

export const useKeywordResearch = () => {
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expansionResult, setExpansionResult] = useState<KeywordExpansionResult | null>(null);
  const [competitorResult, setCompetitorResult] = useState<CompetitorAnalysisResult | null>(null);
  const [activeJob, setActiveJob] = useState<KeywordResearchItem | null>(null);
  const [history, setHistory] = useState<KeywordResearchItem[]>([]);

  // Cancellation for the long-running poll loops (AUDIT 2.20): each
  // start/retry claims a new generation; a later call or unmount invalidates
  // older generations, stopping their polls at the next tick and dropping
  // their stale state updates.
  const pollGenerationRef = useRef(0);

  useEffect(() => () => {
    pollGenerationRef.current += 1;
  }, []);

  const claimGeneration = useCallback(() => {
    const generation = ++pollGenerationRef.current;
    return () => pollGenerationRef.current !== generation;
  }, []);

  /**
   * Follow one job to its terminal status: progress snapshots land in
   * `activeJob`, the merged result in the matching result slot. Shared by
   * start, retry and re-attach.
   */
  const trackJob = useCallback(async (jobId: string, type: ResearchType, isCancelled: () => boolean) => {
    storeActiveJob({
      id: jobId,
      type 
    });
    try {
      const job = await pollResearchJob({
        jobId,
        isCancelled,
        onProgress: (snapshot) => {
          if (!isCancelled()) setActiveJob(snapshot);
        },
        timeoutMessage: TIMEOUT_MESSAGES[type],
      });
      // null means the poll was superseded or unmounted — keep the stored id
      // so a remount can re-attach, and drop the rest silently.
      if (!job) return;
      setActiveJob(job);
      if (job.status === 'failed') {
        setError(job.error_message ?? 'Research failed');
      } else if (type === 'expansion') {
        setExpansionResult(toExpansionResult(job));
      } else {
        setCompetitorResult(toCompetitorResult(job));
      }
      storeActiveJob(null);
    } catch (err) {
      // A superseded call must not overwrite the newer call's error state.
      if (isCancelled()) return;
      storeActiveJob(null);
      setError(getErrorMessage(err, 'research'));
      console.error('[research] Error while waiting for research job:', err);
    } finally {
      // Only the current generation may clear loading; a superseded call
      // finishing late would otherwise flip off the newer call's spinner.
      if (!isCancelled()) setLoading(false);
    }
  }, []);

  const beginRun = useCallback((type: ResearchType) => {
    setLoading(true);
    setError(null);
    setActiveJob(null);
    if (type === 'expansion') {
      setExpansionResult(null);
    } else {
      setCompetitorResult(null);
    }
  }, []);

  const expandKeywords = useCallback(async (seedKeyword: string, industry: string, count: number) => {
    const isCancelled = claimGeneration();
    beginRun('expansion');
    try {
      const job = await startKeywordExpansion(seedKeyword, industry, count);
      if (isCancelled()) return;
      setActiveJob(job);
      await trackJob(job.id, 'expansion', isCancelled);
    } catch (err) {
      if (isCancelled()) return;
      setError(getErrorMessage(err, 'research'));
      setLoading(false);
      console.error('[research] Error expanding keywords:', err);
    }
  }, [beginRun, claimGeneration, trackJob]);

  const analyzeCompetitor = useCallback(async (url: string) => {
    const isCancelled = claimGeneration();
    beginRun('competitor');
    try {
      const job = await startCompetitorAnalysis(url);
      if (isCancelled()) return;
      setActiveJob(job);
      await trackJob(job.id, 'competitor', isCancelled);
    } catch (err) {
      if (isCancelled()) return;
      setError(getErrorMessage(err, 'research'));
      setLoading(false);
      console.error('[research] Error analyzing competitor:', err);
    }
  }, [beginRun, claimGeneration, trackJob]);

  /** Re-run the failed steps of a partial or failed job and follow it again. */
  const retryResearch = useCallback(async (job: KeywordResearchItem) => {
    const isCancelled = claimGeneration();
    beginRun(job.type);
    setActiveJob(job);
    try {
      await retryKeywordResearch(job.id);
      if (isCancelled()) return;
      await trackJob(job.id, job.type, isCancelled);
    } catch (err) {
      if (isCancelled()) return;
      setError(getErrorMessage(err, 'research'));
      setLoading(false);
      console.error('[research] Error retrying research:', err);
    }
  }, [beginRun, claimGeneration, trackJob]);

  // Re-attach to a job the user was waiting on before a refresh or tab switch.
  useEffect(() => {
    const stored = readStoredActiveJob();
    if (stored === null) return;
    const isCancelled = claimGeneration();
    beginRun(stored.type);
    void trackJob(stored.id, stored.type, isCancelled);
  }, [beginRun, claimGeneration, trackJob]);

  const fetchHistory = useCallback(async (type?: ResearchType) => {
    setHistoryLoading(true);
    try {
      setHistory(await fetchKeywordResearchHistory(type));
    } catch (err) {
      console.error('[research] Error fetching history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const deleteResearch = useCallback(async (id: string) => {
    try {
      await deleteKeywordResearch(id);
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
    activeJob,
    history,
    expandKeywords,
    analyzeCompetitor,
    retryResearch,
    fetchHistory,
    deleteResearch,
  };
};
