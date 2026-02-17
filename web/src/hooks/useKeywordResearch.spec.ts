import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useKeywordResearch } from './useKeywordResearch';
import {
  mockExpansionResult, mockCompetitorResult, mockHistoryItems, createMockFetch 
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

interface MockCall {
  0: string;
  1?: {
    body?: string;
    method?: string;
  };
}

function isValidMockCall(call: unknown): call is MockCall {
  return Array.isArray(call) && call.length >= 1 && typeof call[0] === 'string';
}

function hasMethod(callOptions: unknown): callOptions is { method: string } {
  return typeof callOptions === 'object' && callOptions !== null && 'method' in callOptions;
}

function findExpandCall(calls: unknown[][]): MockCall | undefined {
  return calls.find((c) => 
    isValidMockCall(c) && c[0].includes('/expand')
  ) as MockCall | undefined;
}

function findCompetitorCall(calls: unknown[][]): MockCall | undefined {
  return calls.find((c) => 
    isValidMockCall(c) && c[0].includes('/competitor')
  ) as MockCall | undefined;
}

function findDeleteCall(calls: unknown[][]): MockCall | undefined {
  return calls.find((c) => 
    isValidMockCall(c) && c[1] && hasMethod(c[1]) && c[1].method === 'DELETE'
  ) as MockCall | undefined;
}

function createPromiseResolver(): {
  promise: Promise<Response>;
  resolve: (value: Response) => void;
} {
  const resolver: { resolve: (value: Response) => void } = { resolve: vi.fn() };
  const promise = new Promise<Response>((res) => {
    resolver.resolve = res;
  });
  return {
    promise,
    resolve: resolver.resolve 
  };
}

function createMockResponse(data: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(data)
  } satisfies Partial<Response> as Response;
}

describe('useKeywordResearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns loading false initially', () => {
      const { result } = renderHook(() => useKeywordResearch());
      expect(result.current.loading).toBe(false);
    });

    it('returns null expansionResult initially', () => {
      const { result } = renderHook(() => useKeywordResearch());
      expect(result.current.expansionResult).toBeNull();
    });

    it('returns null competitorResult initially', () => {
      const { result } = renderHook(() => useKeywordResearch());
      expect(result.current.competitorResult).toBeNull();
    });

    it('returns empty history initially', () => {
      const { result } = renderHook(() => useKeywordResearch());
      expect(result.current.history).toStrictEqual([]);
    });
  });

  describe('expandKeywords', () => {
    it('expands keywords and sets result', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.expandKeywords('best hotels', 'hospitality', 10);
      });

      expect(result.current.expansionResult).toStrictEqual(mockExpansionResult);
    });

    it('returns correct number of keywords', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.expandKeywords('best hotels', 'hospitality', 10);
      });

      expect(result.current.expansionResult?.keywords).toHaveLength(2);
    });

    it('sends correct payload to API', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.expandKeywords('test keyword', 'retail', 20);
      });

      const call = findExpandCall(mockAuthenticatedFetch.mock.calls);
      expect(call).toBeDefined();
    });

    it('sends correct request body', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.expandKeywords('test keyword', 'retail', 20);
      });

      const call = findExpandCall(mockAuthenticatedFetch.mock.calls);
      expect(call).toBeDefined();
      expect(call?.[1]?.body).toBeDefined();
      const body = JSON.parse(call?.[1]?.body ?? '{}') as {
        seed_keyword?: string;
        industry?: string;
        count?: number 
      };
      expect(body.seed_keyword).toBe('test keyword');
      expect(body.industry).toBe('retail');
    });

    it('sends count in request body', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.expandKeywords('test keyword', 'retail', 20);
      });

      const call = findExpandCall(mockAuthenticatedFetch.mock.calls);
      const body = JSON.parse(call?.[1]?.body ?? '{}') as { count?: number };
      expect(body.count).toBe(20);
    });

    it('sets loading true while expanding', async () => {
      const {
        promise, resolve 
      } = createPromiseResolver();
      mockAuthenticatedFetch.mockImplementation(() => promise);

      const { result } = renderHook(() => useKeywordResearch());

      act(() => { result.current.expandKeywords('test', 'hospitality', 10); });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolve(createMockResponse(mockExpansionResult));
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('sets error when expansion fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ errorResponse: { error: 'Invalid keyword' } }));

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.expandKeywords('test', 'hospitality', 10);
      });

      expect(result.current.error).toBeTruthy();
    });

    it('clears previous result before new expansion', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.expandKeywords('first', 'hospitality', 10);
      });

      expect(result.current.expansionResult).not.toBeNull();

      const {
        promise, resolve 
      } = createPromiseResolver();
      mockAuthenticatedFetch.mockImplementation(() => promise);

      act(() => { result.current.expandKeywords('second', 'hospitality', 10); });

      expect(result.current.expansionResult).toBeNull();

      await act(async () => {
        resolve(createMockResponse(mockExpansionResult));
      });
    });
  });

  describe('analyzeCompetitor', () => {
    it('analyzes competitor URL and sets result', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.analyzeCompetitor('https://competitor.com');
      });

      expect(result.current.competitorResult).toStrictEqual(mockCompetitorResult);
    });

    it('sets correct URL in result', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.analyzeCompetitor('https://competitor.com');
      });

      expect(result.current.competitorResult?.url).toBe('https://competitor.com');
    });

    it('sends URL in request body', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.analyzeCompetitor('https://test.com/page');
      });

      const call = findCompetitorCall(mockAuthenticatedFetch.mock.calls);
      expect(call).toBeDefined();
      const body = JSON.parse(call?.[1]?.body ?? '{}') as { url?: string };
      expect(body.url).toBe('https://test.com/page');
    });

    it('sets error when analysis fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ errorResponse: { error: 'Invalid URL' } }));

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.analyzeCompetitor('invalid');
      });

      expect(result.current.error).toBeTruthy();
    });
  });

  describe('fetchHistory', () => {
    it('fetches and sets history', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.fetchHistory();
      });

      expect(result.current.history).toStrictEqual(mockHistoryItems);
    });

    it('includes type filter in URL when provided', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.fetchHistory('expansion');
      });

      const url = mockAuthenticatedFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('type=expansion');
    });

    it('sets historyLoading true while fetching', async () => {
      const {
        promise, resolve 
      } = createPromiseResolver();
      mockAuthenticatedFetch.mockImplementation(() => promise);

      const { result } = renderHook(() => useKeywordResearch());

      act(() => { result.current.fetchHistory(); });
      expect(result.current.historyLoading).toBe(true);

      await act(async () => {
        resolve(createMockResponse({ items: [] }));
      });

      await waitFor(() => expect(result.current.historyLoading).toBe(false));
    });
  });

  describe('deleteResearch', () => {
    it('deletes research and removes from history', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.fetchHistory();
      });

      const initialLength = result.current.history.length;

      await act(async () => {
        await result.current.deleteResearch('research-1');
      });

      expect(result.current.history).toHaveLength(initialLength - 1);
    });

    it('removes correct item from history', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.fetchHistory();
      });

      await act(async () => {
        await result.current.deleteResearch('research-1');
      });

      expect(result.current.history.find(h => h.id === 'research-1')).toBeUndefined();
    });

    it('calls DELETE endpoint with correct ID', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useKeywordResearch());

      await act(async () => {
        await result.current.deleteResearch('research-123');
      });

      const deleteCall = findDeleteCall(mockAuthenticatedFetch.mock.calls);
      expect(deleteCall).toBeDefined();
      expect(deleteCall?.[0]).toContain('/keyword-research/research-123');
    });
  });
});
