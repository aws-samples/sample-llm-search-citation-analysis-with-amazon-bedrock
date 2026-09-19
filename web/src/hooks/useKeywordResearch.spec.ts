import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import {
  createDeferredResponse, createMockJsonResponse 
} from '../test/fetchResponses';
import { POLL_FAST_INTERVAL_MS } from './researchPolling';
import { useKeywordResearch } from './useKeywordResearch';
import {
  mockHistoryItems,
  buildJob,
  buildStep,
  buildCompletedExpansionJob,
  buildCompletedCompetitorJob,
  runningJobResearchOptions,
} from './useKeywordResearch-fixtures';
import {
  countJobPolls,
  findCall,
  renderResearch,
  startCompetitorAnalysis,
  startExpansion,
} from './useKeywordResearch-harness-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const ACTIVE_JOB_STORAGE_KEY = 'keywordResearch.activeJob';

describe('useKeywordResearch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('returns loading false initially', () => {
      const { result } = renderResearch();
      expect(result.current.loading).toBe(false);
    });

    it('returns null results and no active job initially', () => {
      const { result } = renderResearch();
      expect(result.current.expansionResult).toBeNull();
      expect(result.current.competitorResult).toBeNull();
      expect(result.current.activeJob).toBeNull();
    });

    it('returns empty history initially', () => {
      const { result } = renderResearch();
      expect(result.current.history).toStrictEqual([]);
    });
  });

  describe('expandKeywords', () => {
    it('sends the seed keyword, industry and count to the expand endpoint', async () => {
      const { result } = renderResearch({ snapshots: { 'job-1': [buildCompletedExpansionJob('job-1', 'test keyword')] } });

      await act(async () => {
        void result.current.expandKeywords('test keyword', 'retail', 30);
        await vi.advanceTimersByTimeAsync(POLL_FAST_INTERVAL_MS);
      });

      const call = findCall((c) => c.method === 'POST' && c.url.endsWith('/keyword-research/expand'));
      expect(JSON.parse(call?.body ?? '{}')).toStrictEqual({
        seed_keyword: 'test keyword',
        industry: 'retail',
        count: 30,
      });
    });

    it('exposes the pending job as the active job before the first poll', async () => {
      const { result } = renderResearch(runningJobResearchOptions);

      await startExpansion(result, 0);

      expect(result.current.activeJob?.id).toBe('job-1');
      expect(result.current.activeJob?.status).toBe('pending');
      expect(result.current.loading).toBe(true);
    });

    it('sets the expansion result when a poll finds the completed job', async () => {
      const { result } = renderResearch({ snapshots: { 'job-1': [buildCompletedExpansionJob('job-1', 'best hotels')] } });

      await startExpansion(result);

      expect(result.current.expansionResult).toStrictEqual({
        id: 'job-1',
        seed_keyword: 'best hotels',
        industry: 'hospitality',
        keyword_count: 1,
        keywords: [{
          keyword: 'best hotels deluxe',
          intent: 'commercial',
          competition: 'low',
          relevance: 0.9,
          opportunity: 'high',
          providers: ['openai'],
        }],
      });
      expect(result.current.loading).toBe(false);
    });

    it('updates the active job with progress while providers are still running', async () => {
      const running = buildJob({
        status: 'running',
        steps_total: 3,
        steps_done: 1,
        steps: [buildStep('perplexity'), buildStep('openai', { status: 'running' }), buildStep('gemini', { status: 'pending' })],
      });
      const { result } = renderResearch({ snapshots: { 'job-1': [running, buildCompletedExpansionJob('job-1', 'best hotels')] } });

      await startExpansion(result);

      expect(result.current.activeJob?.steps_done).toBe(1);
      expect(result.current.activeJob?.steps?.map((step) => step.status)).toStrictEqual(['completed', 'running', 'pending']);
      expect(result.current.loading).toBe(true);
    });

    it('keeps the merged keywords of a partial job and reports the partial status', async () => {
      const partial = buildCompletedExpansionJob('job-1', 'best hotels');
      partial.status = 'partial';
      partial.steps_total = 2;
      partial.steps_failed = 1;
      partial.error_message = 'perplexity: 401 invalid_api_key';
      const { result } = renderResearch({ snapshots: { 'job-1': [partial] } });

      await startExpansion(result);

      expect(result.current.expansionResult?.keywords).toHaveLength(1);
      expect(result.current.activeJob?.status).toBe('partial');
      expect(result.current.error).toBeNull();
    });

    it('surfaces the job error message when every provider failed', async () => {
      const failed = buildJob({
        status: 'failed',
        error_message: 'openai: timeout; perplexity: 401' 
      });
      const { result } = renderResearch({ snapshots: { 'job-1': [failed] } });

      await startExpansion(result);

      expect(result.current.error).toBe('openai: timeout; perplexity: 401');
      expect(result.current.expansionResult).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('shows the server rejection when the job cannot be started', async () => {
      const { result } = renderResearch({ startError: { error: 'Invalid keyword' } });

      await act(() => result.current.expandKeywords('test', 'hospitality', 10));

      expect(result.current.error).toBe('Invalid keyword');
      expect(result.current.loading).toBe(false);
    });

    it('clears the previous result and active job when a new expansion starts', async () => {
      const { result } = renderResearch({
        pendingIds: ['job-1', 'job-2'],
        snapshots: {
          'job-1': [buildCompletedExpansionJob('job-1', 'first')],
          'job-2': [buildJob({
            id: 'job-2',
            status: 'running' 
          })],
        },
      });

      await startExpansion(result, POLL_FAST_INTERVAL_MS, 'first');
      expect(result.current.expansionResult?.id).toBe('job-1');

      await startExpansion(result, 0, 'second');

      expect(result.current.expansionResult).toBeNull();
      expect(result.current.activeJob?.id).toBe('job-2');
    });
  });

  describe('analyzeCompetitor', () => {
    it('sends the URL to the competitor endpoint', async () => {
      const { result } = renderResearch({ snapshots: { 'job-1': [buildCompletedCompetitorJob('job-1', 'https://test.com/page')] } });

      await startCompetitorAnalysis(result, 'https://test.com/page');

      const call = findCall((c) => c.method === 'POST' && c.url.endsWith('/keyword-research/competitor'));
      expect(JSON.parse(call?.body ?? '{}')).toStrictEqual({ url: 'https://test.com/page' });
    });

    it('maps the completed job analysis onto the competitor result', async () => {
      const { result } = renderResearch({ snapshots: { 'job-1': [buildCompletedCompetitorJob('job-1', 'https://competitor.com')] } });

      await startCompetitorAnalysis(result, 'https://competitor.com');

      expect(result.current.competitorResult?.url).toBe('https://competitor.com');
      expect(result.current.competitorResult?.industry).toBe('hospitality');
      expect(result.current.competitorResult?.primary_keywords.map((k) => k.keyword)).toStrictEqual(['hotel deals']);
      expect(result.current.competitorResult?.secondary_keywords.map((k) => k.keyword)).toStrictEqual(['vacation packages']);
    });

    it('shows the server rejection when the URL is refused', async () => {
      const { result } = renderResearch({ startError: { error: 'Invalid URL' } });

      await act(() => result.current.analyzeCompetitor('invalid'));

      expect(result.current.error).toBe('Invalid URL');
    });
  });

  describe('retryResearch', () => {
    it('posts to the retry endpoint and follows the job again', async () => {
      const partial = buildCompletedExpansionJob('job-1', 'best hotels');
      partial.status = 'partial';
      const retried = buildCompletedExpansionJob('job-1', 'best hotels');
      retried.retry_count = 1;
      const { result } = renderResearch({ snapshots: { 'job-1': [retried] } });

      await act(async () => {
        void result.current.retryResearch(partial);
        await vi.advanceTimersByTimeAsync(POLL_FAST_INTERVAL_MS);
      });

      const call = findCall((c) => c.method === 'POST' && c.url.endsWith('/keyword-research/job-1/retry'));
      expect(call).toBeDefined();
      expect(result.current.activeJob?.retry_count).toBe(1);
      expect(result.current.expansionResult?.id).toBe('job-1');
    });

    it('shows the job while the retry is pending', async () => {
      const partial = buildCompletedExpansionJob('job-1', 'best hotels');
      partial.status = 'partial';
      const { result } = renderResearch(runningJobResearchOptions);

      await act(async () => {
        void result.current.retryResearch(partial);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.loading).toBe(true);
      expect(result.current.activeJob?.id).toBe('job-1');
    });
  });

  describe('re-attaching after a refresh', () => {
    it('resumes polling the job stored in the browser', async () => {
      localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify({
        id: 'job-9',
        type: 'expansion' 
      }));

      const { result } = renderResearch({ snapshots: { 'job-9': [buildCompletedExpansionJob('job-9', 'resumed')] } });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_FAST_INTERVAL_MS);
      });

      expect(result.current.expansionResult?.seed_keyword).toBe('resumed');
      expect(localStorage.getItem(ACTIVE_JOB_STORAGE_KEY)).toBeNull();
    });

    it('remembers the job while it is still running', async () => {
      const { result } = renderResearch(runningJobResearchOptions);

      await startExpansion(result);

      expect(JSON.parse(localStorage.getItem(ACTIVE_JOB_STORAGE_KEY) ?? '{}')).toStrictEqual({
        id: 'job-1',
        type: 'expansion',
      });
    });

    it('ignores a malformed stored job', () => {
      localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, '{"id": 7}');

      const { result } = renderResearch();

      expect(result.current.loading).toBe(false);
      expect(countJobPolls()).toBe(0);
    });
  });

  describe('fetchHistory', () => {
    it('fetches and sets history', async () => {
      const { result } = renderResearch();

      await act(() => result.current.fetchHistory());

      expect(result.current.history).toStrictEqual(mockHistoryItems);
    });

    it('includes the type filter in the URL when provided', async () => {
      const { result } = renderResearch();

      await act(() => result.current.fetchHistory('expansion'));

      const call = findCall((c) => c.url.includes('/keyword-research/history'));
      expect(call?.url).toContain('type=expansion');
    });

    it('sets historyLoading true while fetching', async () => {
      // waitFor needs real timers.
      vi.useRealTimers();
      const pendingHistory = createDeferredResponse();
      mockAuthenticatedFetch.mockImplementation(() => pendingHistory.promise);
      const { result } = renderHook(() => useKeywordResearch());

      act(() => { void result.current.fetchHistory(); });
      expect(result.current.historyLoading).toBe(true);

      await act(async () => {
        pendingHistory.resolve(createMockJsonResponse({ items: [] }));
      });

      await waitFor(() => expect(result.current.historyLoading).toBe(false));
    });
  });

  describe('deleteResearch', () => {
    it('removes the deleted item from history', async () => {
      const { result } = renderResearch();

      await act(() => result.current.fetchHistory());
      await act(() => result.current.deleteResearch('research-1'));

      expect(result.current.history.map((item) => item.id)).toStrictEqual(['research-2']);
    });

    it('calls the DELETE endpoint for the given id', async () => {
      const { result } = renderResearch();

      await act(() => result.current.deleteResearch('research-123'));

      const call = findCall((c) => c.method === 'DELETE');
      expect(call?.url).toBe('https://api.test.com/keyword-research/research-123');
    });
  });

  // Regression tests for AUDIT 2.20: the poll loop previously had no
  // cancellation path (kept fetching after unmount or a newer call) and
  // treated auth failures as "not ready yet" (the user waited the full window
  // to get a bogus timeout).
  describe('polling lifecycle (AUDIT 2.20)', () => {
    it('surfaces an auth error after the first poll when the session expires', async () => {
      const { result } = renderResearch({ pollResponse: () => createMockJsonResponse({}, 401) });

      await startExpansion(result);

      expect(result.current.error).toBe('Authentication required for keyword research');
      expect(result.current.loading).toBe(false);
    });

    it('stops polling after an auth failure instead of retrying until timeout', async () => {
      const { result } = renderResearch({ pollResponse: () => createMockJsonResponse({}, 401) });

      await startExpansion(result, POLL_FAST_INTERVAL_MS * 5);

      expect(countJobPolls()).toBe(1);
    });

    it('stops polling when the job was deleted underneath it', async () => {
      const { result } = renderResearch({ snapshots: {} });

      await startExpansion(result, POLL_FAST_INTERVAL_MS * 3);

      expect(countJobPolls()).toBe(1);
      expect(result.current.error).toBe('Research data not found');
    });

    it('keeps polling through a transient server error', async () => {
      const pollResponses = [
        createMockJsonResponse({}, 503),
        createMockJsonResponse(buildCompletedExpansionJob('job-1', 'best hotels')),
      ];
      const { result } = renderResearch({pollResponse: () => pollResponses.shift() ?? createMockJsonResponse({}, 503),});

      await startExpansion(result, POLL_FAST_INTERVAL_MS * 2);

      expect(countJobPolls()).toBe(2);
      expect(result.current.expansionResult?.id).toBe('job-1');
    });

    it('stops polling when the component unmounts mid-poll', async () => {
      const {
        result, unmount 
      } = renderResearch(runningJobResearchOptions);

      await startExpansion(result);
      expect(countJobPolls()).toBe(1);

      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_FAST_INTERVAL_MS * 5);
      });

      expect(countJobPolls()).toBe(1);
    });

    it('drops the superseded poll when a newer expansion starts', async () => {
      const { result } = renderResearch({
        pendingIds: ['job-1', 'job-2'],
        snapshots: {
          'job-1': [buildCompletedExpansionJob('job-1', 'first seed')],
          'job-2': [buildCompletedExpansionJob('job-2', 'second seed')],
        },
      });

      await act(async () => {
        void result.current.expandKeywords('first seed', 'hospitality', 10);
        void result.current.expandKeywords('second seed', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_FAST_INTERVAL_MS);
      });

      // Only the second generation polled; the first exited without fetching.
      expect(countJobPolls()).toBe(1);
      expect(result.current.expansionResult?.id).toBe('job-2');
      expect(result.current.loading).toBe(false);
    });

    it('slows down to ten-second polls after the first minute', async () => {
      const { result } = renderResearch(runningJobResearchOptions);

      await startExpansion(result, 60_000);
      expect(countJobPolls()).toBe(20);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(countJobPolls()).toBe(23);
    });
  });
});
