import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useKeywordResearch } from './useKeywordResearch';
import {
  mockHistoryItems,
  buildJob,
  buildStep,
  buildCompletedExpansionJob,
  buildCompletedCompetitorJob,
  createResearchMockFetch,
} from './useKeywordResearch-fixtures';

vi.mock('../infrastructure', async () => {
  const actual: Record<string, unknown> = await vi.importActual('../infrastructure');
  return {
    ...actual,
    API_BASE_URL: 'https://api.test.com',
    authenticatedFetch: vi.fn(),
  };
});

import { authenticatedFetch } from '../infrastructure';

const mockAuthenticatedFetch = vi.mocked(authenticatedFetch);

const POLL_TICK_MS = 3000;
const ACTIVE_JOB_STORAGE_KEY = 'keywordResearch.activeJob';

interface RecordedCall {
  url: string;
  method: string;
  body: string | undefined;
}

function recordedCalls(): RecordedCall[] {
  return mockAuthenticatedFetch.mock.calls.map((call) => {
    const [url, init] = call as [string, RequestInit | undefined];
    return {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
  });
}

function findCall(predicate: (call: RecordedCall) => boolean): RecordedCall | undefined {
  return recordedCalls().find(predicate);
}

function countJobPolls(): number {
  return recordedCalls().filter((call) => call.method === 'GET' && /\/keyword-research\/[^/?]+$/.test(call.url)).length;
}

describe('useKeywordResearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns loading false initially', () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch());
      const { result } = renderHook(() => useKeywordResearch());
      expect(result.current.loading).toBe(false);
    });

    it('returns null results and no active job initially', () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch());
      const { result } = renderHook(() => useKeywordResearch());
      expect(result.current.expansionResult).toBeNull();
      expect(result.current.competitorResult).toBeNull();
      expect(result.current.activeJob).toBeNull();
    });

    it('returns empty history initially', () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch());
      const { result } = renderHook(() => useKeywordResearch());
      expect(result.current.history).toStrictEqual([]);
    });
  });

  describe('expandKeywords', () => {
    it('sends the seed keyword, industry and count to the expand endpoint', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({snapshots: { 'job-1': [buildCompletedExpansionJob('job-1', 'test keyword')] },}));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('test keyword', 'retail', 30);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

      const call = findCall((c) => c.method === 'POST' && c.url.endsWith('/keyword-research/expand'));
      expect(JSON.parse(call?.body ?? '{}')).toStrictEqual({
        seed_keyword: 'test keyword',
        industry: 'retail',
        count: 30,
      });
    });

    it('exposes the pending job as the active job before the first poll', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({snapshots: { 'job-1': [buildJob({ status: 'running' })] },}));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.activeJob?.id).toBe('job-1');
      expect(result.current.activeJob?.status).toBe('pending');
      expect(result.current.loading).toBe(true);
    });

    it('sets the expansion result when a poll finds the completed job', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({snapshots: { 'job-1': [buildCompletedExpansionJob('job-1', 'best hotels')] },}));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

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
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({snapshots: { 'job-1': [running, buildCompletedExpansionJob('job-1', 'best hotels')] },}));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

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
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({ snapshots: { 'job-1': [partial] } }));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

      expect(result.current.expansionResult?.keywords).toHaveLength(1);
      expect(result.current.activeJob?.status).toBe('partial');
      expect(result.current.error).toBeNull();
    });

    it('surfaces the job error message when every provider failed', async () => {
      const failed = buildJob({
        status: 'failed',
        error_message: 'openai: timeout; perplexity: 401' 
      });
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({ snapshots: { 'job-1': [failed] } }));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

      expect(result.current.error).toBe('openai: timeout; perplexity: 401');
      expect(result.current.expansionResult).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('shows the server rejection when the job cannot be started', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({ startError: { error: 'Invalid keyword' } }));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.expandKeywords('test', 'hospitality', 10);
      });

      expect(result.current.error).toBe('Invalid keyword');
      expect(result.current.loading).toBe(false);
    });

    it('clears the previous result and active job when a new expansion starts', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({
        pendingIds: ['job-1', 'job-2'],
        snapshots: {
          'job-1': [buildCompletedExpansionJob('job-1', 'first')],
          'job-2': [buildJob({
            id: 'job-2',
            status: 'running' 
          })],
        },
      }));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('first', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });
      expect(result.current.expansionResult?.id).toBe('job-1');

      await act(async () => {
        void result.current.expandKeywords('second', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.expansionResult).toBeNull();
      expect(result.current.activeJob?.id).toBe('job-2');
    });
  });

  describe('analyzeCompetitor', () => {
    it('sends the URL to the competitor endpoint', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({snapshots: { 'job-1': [buildCompletedCompetitorJob('job-1', 'https://test.com/page')] },}));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.analyzeCompetitor('https://test.com/page');
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

      const call = findCall((c) => c.method === 'POST' && c.url.endsWith('/keyword-research/competitor'));
      expect(JSON.parse(call?.body ?? '{}')).toStrictEqual({ url: 'https://test.com/page' });
    });

    it('maps the completed job analysis onto the competitor result', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({snapshots: { 'job-1': [buildCompletedCompetitorJob('job-1', 'https://competitor.com')] },}));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.analyzeCompetitor('https://competitor.com');
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

      expect(result.current.competitorResult?.url).toBe('https://competitor.com');
      expect(result.current.competitorResult?.industry).toBe('hospitality');
      expect(result.current.competitorResult?.primary_keywords.map((k) => k.keyword)).toStrictEqual(['hotel deals']);
      expect(result.current.competitorResult?.secondary_keywords.map((k) => k.keyword)).toStrictEqual(['vacation packages']);
    });

    it('shows the server rejection when the URL is refused', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({ startError: { error: 'Invalid URL' } }));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.analyzeCompetitor('invalid');
      });

      expect(result.current.error).toBe('Invalid URL');
    });
  });

  describe('retryResearch', () => {
    it('posts to the retry endpoint and follows the job again', async () => {
      const partial = buildCompletedExpansionJob('job-1', 'best hotels');
      partial.status = 'partial';
      const retried = buildCompletedExpansionJob('job-1', 'best hotels');
      retried.retry_count = 1;
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({ snapshots: { 'job-1': [retried] } }));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.retryResearch(partial);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

      const call = findCall((c) => c.method === 'POST' && c.url.endsWith('/keyword-research/job-1/retry'));
      expect(call).toBeDefined();
      expect(result.current.activeJob?.retry_count).toBe(1);
      expect(result.current.expansionResult?.id).toBe('job-1');
    });

    it('shows the job while the retry is pending', async () => {
      const partial = buildCompletedExpansionJob('job-1', 'best hotels');
      partial.status = 'partial';
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({snapshots: { 'job-1': [buildJob({ status: 'running' })] },}));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.retryResearch(partial);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.loading).toBe(true);
      expect(result.current.activeJob?.id).toBe('job-1');
    });
  });

  describe('re-attaching after a refresh', () => {
    it('resumes polling the job stored in the session', async () => {
      sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify({
        id: 'job-9',
        type: 'expansion' 
      }));
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({snapshots: { 'job-9': [buildCompletedExpansionJob('job-9', 'resumed')] },}));

      const { result } = renderHook(() => useKeywordResearch());
      expect(result.current.loading).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

      expect(result.current.expansionResult?.seed_keyword).toBe('resumed');
      expect(sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY)).toBeNull();
    });

    it('remembers the job while it is still running', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({snapshots: { 'job-1': [buildJob({ status: 'running' })] },}));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

      expect(JSON.parse(sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY) ?? '{}')).toStrictEqual({
        id: 'job-1',
        type: 'expansion',
      });
    });

    it('ignores a malformed stored job', () => {
      sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY, '{"id": 7}');
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      expect(result.current.loading).toBe(false);
      expect(countJobPolls()).toBe(0);
    });
  });

  describe('fetchHistory', () => {
    it('fetches and sets history', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch());
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.fetchHistory();
      });

      expect(result.current.history).toStrictEqual(mockHistoryItems);
    });

    it('includes the type filter in the URL when provided', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch());
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.fetchHistory('expansion');
      });

      const call = findCall((c) => c.url.includes('/keyword-research/history'));
      expect(call?.url).toContain('type=expansion');
    });

    it('sets historyLoading true while fetching', async () => {
      // waitFor needs real timers.
      vi.useRealTimers();
      const pending: { resolve: (value: Response) => void } = { resolve: vi.fn() };
      mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>((resolve) => {
        pending.resolve = resolve;
      }));
      const { result } = renderHook(() => useKeywordResearch());

      act(() => { void result.current.fetchHistory(); });
      expect(result.current.historyLoading).toBe(true);

      await act(async () => {
        pending.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ items: [] }) 
        } satisfies Partial<Response> as Response);
      });

      await waitFor(() => expect(result.current.historyLoading).toBe(false));
    });
  });

  describe('deleteResearch', () => {
    it('removes the deleted item from history', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch());
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.fetchHistory();
      });
      await act(async () => {
        await result.current.deleteResearch('research-1');
      });

      expect(result.current.history.map((item) => item.id)).toStrictEqual(['research-2']);
    });

    it('calls the DELETE endpoint for the given id', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch());
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.deleteResearch('research-123');
      });

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
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({
        pollResponse: () => ({
          ok: false,
          status: 401,
          json: () => Promise.resolve({}) 
        }),
      }));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

      expect(result.current.error).toBe('Authentication required for keyword research');
      expect(result.current.loading).toBe(false);
    });

    it('stops polling after an auth failure instead of retrying until timeout', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({
        pollResponse: () => ({
          ok: false,
          status: 401,
          json: () => Promise.resolve({}) 
        }),
      }));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS * 5);
      });

      expect(countJobPolls()).toBe(1);
    });

    it('stops polling when the job was deleted underneath it', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({ snapshots: {} }));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS * 3);
      });

      expect(countJobPolls()).toBe(1);
      expect(result.current.error).toBe('Research data not found');
    });

    it('keeps polling through a transient server error', async () => {
      const responses = [
        {
          ok: false,
          status: 503,
          json: () => Promise.resolve({}) 
        },
        {
          ok: true,
          status: 200,
          json: () => Promise.resolve(buildCompletedExpansionJob('job-1', 'best hotels')) 
        },
      ];
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({pollResponse: () => responses.shift() ?? responses[0],}));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS * 2);
      });

      expect(countJobPolls()).toBe(2);
      expect(result.current.expansionResult?.id).toBe('job-1');
    });

    it('stops polling when the component unmounts mid-poll', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({snapshots: { 'job-1': [buildJob({ status: 'running' })] },}));
      const {
        result, unmount 
      } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });
      expect(countJobPolls()).toBe(1);

      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS * 5);
      });

      expect(countJobPolls()).toBe(1);
    });

    it('drops the superseded poll when a newer expansion starts', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({
        pendingIds: ['job-1', 'job-2'],
        snapshots: {
          'job-1': [buildCompletedExpansionJob('job-1', 'first seed')],
          'job-2': [buildCompletedExpansionJob('job-2', 'second seed')],
        },
      }));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('first seed', 'hospitality', 10);
        void result.current.expandKeywords('second seed', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
      });

      // Only the second generation polled; the first exited without fetching.
      expect(countJobPolls()).toBe(1);
      expect(result.current.expansionResult?.id).toBe('job-2');
      expect(result.current.loading).toBe(false);
    });

    it('slows down to ten-second polls after the first minute', async () => {
      mockAuthenticatedFetch.mockImplementation(createResearchMockFetch({snapshots: { 'job-1': [buildJob({ status: 'running' })] },}));
      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        void result.current.expandKeywords('best hotels', 'hospitality', 10);
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(countJobPolls()).toBe(20);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(countJobPolls()).toBe(23);
    });
  });
});
