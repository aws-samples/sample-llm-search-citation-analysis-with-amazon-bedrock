import {
  useCallback, useEffect, useMemo, useRef, useState
} from 'react';
import {
  deleteKeywordResearch,
  fetchKeywordResearch,
  fetchKeywordResearchHistory,
  retryKeywordResearch,
  startResearchAgent,
} from '../api/keywordResearch';
import type { StartAgentRequest } from '../api/keywordResearch';
import {
  getErrorMessage, isAbortError
} from '../infrastructure';
import { isActiveResearchStatus } from '../formatting/researchStatus';
import type { KeywordResearchItem } from '../types';

/** How often every running agent job is re-read while any is active. */
export const AGENT_POLL_INTERVAL_MS = 5_000;

interface UseResearchAgentReturn {
  /** Every agent run, newest first — running ones keep updating. */
  jobs: KeywordResearchItem[];
  /** The run the user opened, with its prompt snapshot and trace. */
  selected: KeywordResearchItem | null;
  selectedId: string | null;
  /** True while a run is being started. */
  starting: boolean;
  loadingJobs: boolean;
  error: string | null;
  start: (request: StartAgentRequest) => Promise<KeywordResearchItem | null>;
  select: (id: string | null) => void;
  retry: (job: KeywordResearchItem) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function isActiveJob(job: KeywordResearchItem): boolean {
  return isActiveResearchStatus(job.status);
}

function replaceJob(jobs: KeywordResearchItem[], job: KeywordResearchItem): KeywordResearchItem[] {
  return jobs.some((item) => item.id === job.id)
    ? jobs.map((item) => (item.id === job.id ? job : item))
    : [job, ...jobs];
}

/**
 * Research-agent runs. Unlike expansion/competitor jobs (one job followed at
 * a time), the agent tab lists every run and re-reads the active ones on a
 * timer, so several runs can be shipped and left in the background while the
 * user works on something else (steering 2026-09-18; R22).
 */
export const useResearchAgent = (): UseResearchAgentReturn => {
  const [jobs, setJobs] = useState<KeywordResearchItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The full row of the opened run (the history listing omits the prompt).
  const [detail, setDetail] = useState<KeywordResearchItem | null>(null);
  const [starting, setStarting] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const pollingRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoadingJobs(true);
    try {
      const items = await fetchKeywordResearchHistory('agent');
      if (!mountedRef.current) return;
      setJobs(items);
    } catch (err) {
      if (!mountedRef.current || isAbortError(err)) return;
      setError(getErrorMessage(err, 'research'));
      console.error('[research-agent] Error loading runs:', err);
    } finally {
      if (mountedRef.current) setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Re-read one job; the opened run also refreshes its detail (prompt + trace). */
  const reload = useCallback(async (id: string): Promise<void> => {
    try {
      const job = await fetchKeywordResearch(id);
      if (!mountedRef.current) return;
      setJobs((prev) => replaceJob(prev, job));
      if (selectedIdRef.current === id) setDetail(job);
    } catch (err) {
      if (!isAbortError(err)) console.error('[research-agent] Error reading run:', err);
    }
  }, []);

  // Load the detail when a run is opened.
  useEffect(() => {
    if (selectedId === null) return;
    void reload(selectedId);
  }, [selectedId, reload]);

  const selected = useMemo(() => {
    if (selectedId === null) return null;
    if (detail?.id === selectedId) return detail;
    return jobs.find((job) => job.id === selectedId) ?? null;
  }, [detail, jobs, selectedId]);

  const activeKey = useMemo(() => jobs.filter(isActiveJob).map((job) => job.id).join(','), [jobs]);

  // One timer for every active run: re-read them until none is active.
  useEffect(() => {
    if (activeKey === '') return;
    const ids = activeKey.split(',');
    const tick = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        await Promise.all(ids.map((id) => reload(id)));
      } finally {
        pollingRef.current = false;
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, AGENT_POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [activeKey, reload]);

  const start = useCallback(async (request: StartAgentRequest): Promise<KeywordResearchItem | null> => {
    setStarting(true);
    setError(null);
    try {
      const job = await startResearchAgent(request);
      if (!mountedRef.current) return job;
      setJobs((prev) => replaceJob(prev, job));
      setDetail(job);
      setSelectedId(job.id);
      return job;
    } catch (err) {
      if (!mountedRef.current) return null;
      setError(getErrorMessage(err, 'research'));
      console.error('[research-agent] Error starting run:', err);
      return null;
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const retry = useCallback(async (job: KeywordResearchItem): Promise<void> => {
    setError(null);
    try {
      await retryKeywordResearch(job.id);
      if (!mountedRef.current) return;
      const pending: KeywordResearchItem = {
        ...job,
        status: 'pending',
        error_message: undefined,
      };
      setJobs((prev) => replaceJob(prev, pending));
      setSelectedId(job.id);
      await reload(job.id);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(getErrorMessage(err, 'research'));
      console.error('[research-agent] Error retrying run:', err);
    }
  }, [reload]);

  const remove = useCallback(async (id: string): Promise<void> => {
    try {
      await deleteKeywordResearch(id);
      if (!mountedRef.current) return;
      setJobs((prev) => prev.filter((job) => job.id !== id));
      setSelectedId((prev) => (prev === id ? null : prev));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(getErrorMessage(err, 'research'));
      console.error('[research-agent] Error deleting run:', err);
    }
  }, []);

  return {
    jobs,
    selected,
    selectedId,
    starting,
    loadingJobs,
    error,
    start,
    select,
    retry,
    remove,
    refresh,
  };
};
