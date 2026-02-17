import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useRecommendations } from './useRecommendations';
import type { RecommendationsResponse } from '../types';
import {
  mockRecommendationsResponse, createMockFetch 
} from './useRecommendations-fixtures';

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

describe('useRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns null data initially', () => {
      const { result } = renderHook(() => useRecommendations());
      expect(result.current.data).toBeNull();
    });

    it('returns loading false initially', () => {
      const { result } = renderHook(() => useRecommendations());
      expect(result.current.loading).toBe(false);
    });

    it('returns null error initially', () => {
      const { result } = renderHook(() => useRecommendations());
      expect(result.current.error).toBeNull();
    });
  });

  describe('fetchRecommendations', () => {
    it('fetches and returns recommendations', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRecommendations());

      const holder: { value: RecommendationsResponse | null } = { value: null };
      await act(async () => {
        holder.value = await result.current.fetchRecommendations();
      });

      expect(holder.value?.recommendations).toHaveLength(2);
      expect(holder.value?.total_count).toBe(2);
      expect(result.current.data).toStrictEqual(mockRecommendationsResponse);
    });

    it('includes use_llm false in URL params by default', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRecommendations());

      await act(async () => {
        await result.current.fetchRecommendations();
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('use_llm=false');
    });

    it('includes use_llm true in URL params when specified', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRecommendations());

      await act(async () => {
        await result.current.fetchRecommendations(true);
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('use_llm=true');
    });

    it('sets loading true while fetching', async () => {
      const resolvePromise = { fn: null as ((value: unknown) => void) | null };
      const createMockPromise = (resolve: (value: unknown) => void) => {
        resolvePromise.fn = resolve;
      };
      mockAuthenticatedFetch.mockImplementation(() => new Promise(createMockPromise));

      const { result } = renderHook(() => useRecommendations());

      act(() => { result.current.fetchRecommendations(); });
      expect(result.current.loading).toBe(true);

      const mockResponse = {
        ok: true,
        json: () => Promise.resolve(mockRecommendationsResponse) 
      };
      await act(async () => {
        resolvePromise.fn?.(mockResponse);
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('sets error when fetch fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

      const { result } = renderHook(() => useRecommendations());

      await act(async () => {
        await result.current.fetchRecommendations();
      });

      expect(result.current.error).toBeTruthy();
    });

    it('sets error when response format is invalid', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ invalidResponse: true }));

      const { result } = renderHook(() => useRecommendations());

      await act(async () => {
        await result.current.fetchRecommendations();
      });

      expect(result.current.error).toBeTruthy();
    });

    it('returns null when fetch fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

      const { result } = renderHook(() => useRecommendations());

      const fetchResult = { value: null as typeof mockRecommendationsResponse | null };
      const performFetch = async () => {
        fetchResult.value = await result.current.fetchRecommendations();
      };
      await act(performFetch);

      expect(fetchResult.value).toBeNull();
    });

    it('clears previous error on new fetch', async () => {
      mockAuthenticatedFetch
        .mockImplementationOnce(createMockFetch({ shouldFail: true }))
        .mockImplementationOnce(createMockFetch());

      const { result } = renderHook(() => useRecommendations());

      await act(async () => {
        await result.current.fetchRecommendations();
      });
      expect(result.current.error).toBeTruthy();

      await act(async () => {
        await result.current.fetchRecommendations();
      });
      expect(result.current.error).toBeNull();
    });
  });
});
