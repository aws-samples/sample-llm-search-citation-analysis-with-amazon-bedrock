import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useHistoricalTrends } from './useHistoricalTrends';
import {
  mockSingleKeywordResponse, mockAllKeywordsResponse, createMockFetch 
} from './useHistoricalTrends-fixtures';

vi.mock('../infrastructure', async () => {
  const actual = await vi.importActual('../infrastructure');
  return {
    ...actual,
    API_BASE_URL: 'https://api.test.com',
    authenticatedFetch: vi.fn(),
  };
});

import { authenticatedFetch } from '../infrastructure';

const mockAuthenticatedFetch = authenticatedFetch as ReturnType<typeof vi.fn>;

describe('useHistoricalTrends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns null data initially', () => {
      const { result } = renderHook(() => useHistoricalTrends());
      expect(result.current.data).toBeNull();
    });

    it('returns loading false initially', () => {
      const { result } = renderHook(() => useHistoricalTrends());
      expect(result.current.loading).toBe(false);
    });

    it('returns null error initially', () => {
      const { result } = renderHook(() => useHistoricalTrends());
      expect(result.current.error).toBeNull();
    });
  });

  describe('fetchHistoricalTrends', () => {
    it('fetches and returns trends for keyword', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useHistoricalTrends());

      const fetchResult: { value: typeof mockSingleKeywordResponse | null } = { value: null };
      await act(async () => {
        fetchResult.value = await result.current.fetchHistoricalTrends('best hotels');
      });

      expect(fetchResult.value?.keyword).toBe('best hotels');
      expect(fetchResult.value?.trend_direction).toBe('improving');
      expect(result.current.data).toStrictEqual(mockSingleKeywordResponse);
    });

    it('includes keyword in URL params when provided', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useHistoricalTrends());

      await act(async () => {
        await result.current.fetchHistoricalTrends('best hotels');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('keyword=best+hotels');
    });

    it('fetches all keywords when no keyword provided', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ response: mockAllKeywordsResponse }));

      const { result } = renderHook(() => useHistoricalTrends());

      await act(async () => {
        await result.current.fetchHistoricalTrends();
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).not.toContain('keyword=');
    });

    it('includes period in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useHistoricalTrends());

      await act(async () => {
        await result.current.fetchHistoricalTrends('test', 'week');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('period=week');
    });

    it('includes days in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useHistoricalTrends());

      await act(async () => {
        await result.current.fetchHistoricalTrends('test', 'day', 60);
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('days=60');
    });

    it('uses default period of day', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useHistoricalTrends());

      await act(async () => {
        await result.current.fetchHistoricalTrends('test');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('period=day');
    });

    it('uses default days of 30', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useHistoricalTrends());

      await act(async () => {
        await result.current.fetchHistoricalTrends('test');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('days=30');
    });

    it('sets loading true while fetching', async () => {
      // noop function for resolvePromise
      const noop = () => {
        // empty function
      };
      const resolvePromise: { fn: (value: unknown) => void } = { fn: noop };
      
      const promiseResolver = (resolve: (value: unknown) => void) => { 
        resolvePromise.fn = resolve; 
      };
      
      const mockImplementation = () => {
        return new Promise(promiseResolver);
      };
      mockAuthenticatedFetch.mockImplementation(mockImplementation);

      const { result } = renderHook(() => useHistoricalTrends());

      act(() => { 
        result.current.fetchHistoricalTrends('test'); 
      });
      expect(result.current.loading).toBe(true);

      const mockJsonResponse = () => Promise.resolve(mockSingleKeywordResponse);
      const mockResponse = {
        ok: true,
        json: mockJsonResponse
      };

      await act(async () => {
        resolvePromise.fn(mockResponse);
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('sets error when fetch fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

      const { result } = renderHook(() => useHistoricalTrends());

      await act(async () => {
        await result.current.fetchHistoricalTrends('test');
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.data).toBeNull();
    });

    it('sets error when backend returns error response', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ errorResponse: { error: 'No data' } }));

      const { result } = renderHook(() => useHistoricalTrends());

      await act(async () => {
        await result.current.fetchHistoricalTrends('test');
      });

      expect(result.current.error).toBeTruthy();
    });

    it('sets error when response format is invalid', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ invalidResponse: true }));

      const { result } = renderHook(() => useHistoricalTrends());

      await act(async () => {
        await result.current.fetchHistoricalTrends('test');
      });

      expect(result.current.error).toBeTruthy();
    });

    it('returns null when fetch fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

      const { result } = renderHook(() => useHistoricalTrends());

      const fetchResult: { value: typeof mockSingleKeywordResponse | null } = { value: null };
      await act(async () => {
        fetchResult.value = await result.current.fetchHistoricalTrends('test');
      });

      expect(fetchResult.value).toBeNull();
    });

    it('clears previous error on new fetch', async () => {
      mockAuthenticatedFetch
        .mockImplementationOnce(createMockFetch({ shouldFail: true }))
        .mockImplementationOnce(createMockFetch());

      const { result } = renderHook(() => useHistoricalTrends());

      await act(async () => {
        await result.current.fetchHistoricalTrends('test');
      });
      expect(result.current.error).toBeTruthy();

      await act(async () => {
        await result.current.fetchHistoricalTrends('test');
      });
      expect(result.current.error).toBeNull();
    });
  });
});
