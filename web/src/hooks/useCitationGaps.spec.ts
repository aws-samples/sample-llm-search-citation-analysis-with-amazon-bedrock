import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useCitationGaps } from './useCitationGaps';
import {
  mockCitationGapsResponse,
  mockAllKeywordsResponse,
  createMockFetch,
} from './useCitationGaps-fixtures';

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

describe('useCitationGaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns null data initially', () => {
      const { result } = renderHook(() => useCitationGaps());

      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('fetchCitationGaps', () => {
    it('sets loading true while fetching', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve(mockCitationGapsResponse),
      };
      
      mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(mockResponse));

      const { result } = renderHook(() => useCitationGaps());

      act(() => {
        result.current.fetchCitationGaps('test keyword');
      });

      expect(result.current.loading).toBe(true);

      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('fetches and returns citation gaps for keyword', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useCitationGaps());

      await act(async () => {
        const data = await result.current.fetchCitationGaps('best hotels');
        expect(data).toStrictEqual(mockCitationGapsResponse);
      });

      expect(result.current.data).toStrictEqual(mockCitationGapsResponse);
      expect(result.current.error).toBeNull();
    });

    it('fetches all keywords when no keyword provided', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({response: mockAllKeywordsResponse,}));

      const { result } = renderHook(() => useCitationGaps());

      await act(async () => {
        await result.current.fetchCitationGaps();
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).not.toContain('keyword=');
      expect(result.current.data?.top_gaps).toBeDefined();
    });

    it('includes keyword in URL params when provided', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useCitationGaps());

      await act(async () => {
        await result.current.fetchCitationGaps('best hotels');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('keyword=best+hotels');
    });

    it('includes limit in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useCitationGaps());

      await act(async () => {
        await result.current.fetchCitationGaps('test', 20);
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=20');
    });

    it('uses default limit of 10', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useCitationGaps());

      await act(async () => {
        await result.current.fetchCitationGaps('test');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=10');
    });

    it('sets error when fetch fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

      const { result } = renderHook(() => useCitationGaps());

      await act(async () => {
        const data = await result.current.fetchCitationGaps('test');
        expect(data).toBeNull();
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.data).toBeNull();
    });

    it('sets error when backend returns error response', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({errorResponse: { error: 'No brand config found' },}));

      const { result } = renderHook(() => useCitationGaps());

      await act(async () => {
        await result.current.fetchCitationGaps('test');
      });

      expect(result.current.error).toBeTruthy();
    });

    it('sets error when response format is invalid', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ invalidResponse: true }));

      const { result } = renderHook(() => useCitationGaps());

      await act(async () => {
        await result.current.fetchCitationGaps('test');
      });

      expect(result.current.error).toBeTruthy();
    });

    it('clears previous error on new fetch', async () => {
      mockAuthenticatedFetch
        .mockImplementationOnce(createMockFetch({ shouldFail: true }))
        .mockImplementationOnce(createMockFetch());

      const { result } = renderHook(() => useCitationGaps());

      await act(async () => {
        await result.current.fetchCitationGaps('test');
      });

      expect(result.current.error).toBeTruthy();

      await act(async () => {
        await result.current.fetchCitationGaps('test');
      });

      expect(result.current.error).toBeNull();
    });

    it('returns data with gaps array for single keyword', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useCitationGaps());

      await act(async () => {
        const data = await result.current.fetchCitationGaps('test');
        expect(data?.gaps).toHaveLength(2);
        expect(data?.gaps?.[0].priority).toBe('high');
        expect(data?.summary?.gap_count).toBe(2);
      });
    });

    it('returns data with top_gaps for all keywords', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({response: mockAllKeywordsResponse,}));

      const { result } = renderHook(() => useCitationGaps());

      await act(async () => {
        const data = await result.current.fetchCitationGaps();
        expect(data?.top_gaps).toHaveLength(1);
        expect(data?.keyword_summaries).toHaveLength(2);
      });
    });
  });
});
