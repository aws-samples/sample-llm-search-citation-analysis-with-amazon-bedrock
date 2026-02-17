import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { usePromptInsights } from './usePromptInsights';
import type { PromptInsightsResponse } from '../types';
import {
  mockPromptInsightsResponse, createMockFetch 
} from './usePromptInsights-fixtures';

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

function createDelayedPromise() {
  const resolvers: { resolve?: (value: unknown) => void } = {};
  const promise = new Promise(resolve => { 
    resolvers.resolve = resolve; 
  });
  return { 
    promise, 
    resolvers 
  };
}

describe('usePromptInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns null data initially', () => {
      const { result } = renderHook(() => usePromptInsights());
      expect(result.current.data).toBeNull();
    });

    it('returns loading false initially', () => {
      const { result } = renderHook(() => usePromptInsights());
      expect(result.current.loading).toBe(false);
    });

    it('returns null error initially', () => {
      const { result } = renderHook(() => usePromptInsights());
      expect(result.current.error).toBeNull();
    });
  });

  describe('fetchPromptInsights', () => {
    it('fetches and returns prompt insights', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => usePromptInsights());

      const holder: { value: PromptInsightsResponse | null } = { value: null };
      await act(async () => {
        holder.value = await result.current.fetchPromptInsights();
      });

      expect(holder.value?.total_prompts_analyzed).toBe(50);
      expect(holder.value?.winning_prompts).toHaveLength(1);
      expect(result.current.data).toStrictEqual(mockPromptInsightsResponse);
    });

    it('includes type in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => usePromptInsights());

      await act(async () => {
        await result.current.fetchPromptInsights('winning');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('type=winning');
    });

    it('includes limit in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => usePromptInsights());

      await act(async () => {
        await result.current.fetchPromptInsights('all', 50);
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=50');
    });

    it('uses default type of all', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => usePromptInsights());

      await act(async () => {
        await result.current.fetchPromptInsights();
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('type=all');
    });

    it('uses default limit of 20', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => usePromptInsights());

      await act(async () => {
        await result.current.fetchPromptInsights();
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=20');
    });

    it('sets loading true while fetching', async () => {
      const { 
        promise, 
        resolvers 
      } = createDelayedPromise();
      mockAuthenticatedFetch.mockImplementation(() => promise);

      const { result } = renderHook(() => usePromptInsights());

      act(() => { result.current.fetchPromptInsights(); });
      expect(result.current.loading).toBe(true);

      const mockResponse = {
        ok: true,
        json: () => Promise.resolve(mockPromptInsightsResponse) 
      };

      await act(async () => {
        resolvers.resolve?.(mockResponse);
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('sets error when fetch fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

      const { result } = renderHook(() => usePromptInsights());

      await act(async () => {
        await result.current.fetchPromptInsights();
      });

      expect(result.current.error).toBeTruthy();
    });

    it('sets error when response format is invalid', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ invalidResponse: true }));

      const { result } = renderHook(() => usePromptInsights());

      await act(async () => {
        await result.current.fetchPromptInsights();
      });

      expect(result.current.error).toBeTruthy();
    });

    it('returns null when fetch fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

      const { result } = renderHook(() => usePromptInsights());

      const fetchResult = { value: null as typeof mockPromptInsightsResponse | null };
      await act(async () => {
        fetchResult.value = await result.current.fetchPromptInsights();
      });

      expect(fetchResult.value).toBeNull();
    });

    it('clears previous error on new fetch', async () => {
      mockAuthenticatedFetch
        .mockImplementationOnce(createMockFetch({ shouldFail: true }))
        .mockImplementationOnce(createMockFetch());

      const { result } = renderHook(() => usePromptInsights());

      await act(async () => {
        await result.current.fetchPromptInsights();
      });
      expect(result.current.error).toBeTruthy();

      await act(async () => {
        await result.current.fetchPromptInsights();
      });
      expect(result.current.error).toBeNull();
    });
  });
});
