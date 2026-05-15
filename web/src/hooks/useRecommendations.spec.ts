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

  describe('updateRecommendationStatus', () => {
    function statusOkResponse(payload: object) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(payload),
      };
    }

    it('posts to /recommendations/{id}/status with the new status', async () => {
      mockAuthenticatedFetch
        .mockImplementationOnce(createMockFetch())
        .mockImplementationOnce(() => Promise.resolve(statusOkResponse({
          recommendation_id: 'rec-001',
          status: 'in_progress',
          updated_at: '2026-05-15T10:00:00Z',
        })));

      const { result } = renderHook(() => useRecommendations());
      await act(async () => {
        await result.current.fetchRecommendations();
      });

      await act(async () => {
        await result.current.updateRecommendationStatus('rec-001', { status: 'in_progress' });
      });

      const url = mockAuthenticatedFetch.mock.calls[1][0] as string;
      expect(url).toContain('/recommendations/rec-001/status');
    });

    it('serialises notes and relationship pointers in the request body', async () => {
      mockAuthenticatedFetch
        .mockImplementationOnce(createMockFetch())
        .mockImplementationOnce(() => Promise.resolve(statusOkResponse({
          recommendation_id: 'rec-001',
          status: 'done',
          updated_at: '2026-05-15T10:00:00Z',
        })));

      const { result } = renderHook(() => useRecommendations());
      await act(async () => {
        await result.current.fetchRecommendations();
      });

      await act(async () => {
        await result.current.updateRecommendationStatus('rec-001', {
          status: 'done',
          notes: 'pitched outdoor pubs',
          relatedKeyword: 'best running shoes',
          relatedContentId: 'content-42',
        });
      });

      const init = mockAuthenticatedFetch.mock.calls[1][1] as RequestInit;
      const body = JSON.parse(init.body as string) as Record<string, string>;
      expect(body.status).toBe('done');
      expect(body.notes).toBe('pitched outdoor pubs');
      expect(body.related_keyword).toBe('best running shoes');
      expect(body.related_content_id).toBe('content-42');
    });

    it('optimistically updates the recommendation status in local state', async () => {
      mockAuthenticatedFetch
        .mockImplementationOnce(createMockFetch())
        .mockImplementationOnce(() => Promise.resolve(statusOkResponse({
          recommendation_id: 'rec-001',
          status: 'done',
          updated_at: '2026-05-15T10:00:00Z',
        })));

      const { result } = renderHook(() => useRecommendations());
      await act(async () => {
        await result.current.fetchRecommendations();
      });

      await act(async () => {
        await result.current.updateRecommendationStatus('rec-001', { status: 'done' });
      });

      const updated = result.current.data?.recommendations.find((r) => r.id === 'rec-001');
      expect(updated?.status).toBe('done');
    });

    it('rolls back the optimistic update when the server call fails', async () => {
      mockAuthenticatedFetch
        .mockImplementationOnce(createMockFetch())
        .mockImplementationOnce(() => Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        }));

      const { result } = renderHook(() => useRecommendations());
      await act(async () => {
        await result.current.fetchRecommendations();
      });

      await act(async () => {
        await result.current.updateRecommendationStatus('rec-001', { status: 'done' });
      });

      const reverted = result.current.data?.recommendations.find((r) => r.id === 'rec-001');
      expect(reverted?.status).toBe('new');
    });

    it('returns null and skips the fetch when id is empty', async () => {
      const { result } = renderHook(() => useRecommendations());
      const ret = await act(
        () => result.current.updateRecommendationStatus('', { status: 'done' }),
      );
      expect(ret).toBeNull();
      expect(mockAuthenticatedFetch).not.toHaveBeenCalled();
    });
  });
});
