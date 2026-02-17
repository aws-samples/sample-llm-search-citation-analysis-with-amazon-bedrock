import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useContentStudio } from './useContentStudio';
import {
  mockContentIdea, createMockFetch 
} from './useContentStudio-fixtures';

interface GenerateResult {
  success: boolean;
  id: string;
}

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

describe('useContentStudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns empty ideas array initially', () => {
      const { result } = renderHook(() => useContentStudio());
      expect(result.current.ideas).toStrictEqual([]);
    });

    it('returns empty history array initially', () => {
      const { result } = renderHook(() => useContentStudio());
      expect(result.current.history).toStrictEqual([]);
    });

    it('returns zero unviewedCount initially', () => {
      const { result } = renderHook(() => useContentStudio());
      expect(result.current.unviewedCount).toBe(0);
    });

    it('returns loading false initially', () => {
      const { result } = renderHook(() => useContentStudio());
      expect(result.current.loading).toBe(false);
    });
  });

  describe('fetchIdeas', () => {
    it('fetches and returns content ideas', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useContentStudio());

      const mutations = { ideas: [] as typeof mockContentIdea[] };
      await act(async () => {
        mutations.ideas = await result.current.fetchIdeas();
      });

      expect(mutations.ideas).toHaveLength(1);
      expect(mutations.ideas[0].keyword).toBe('best hotels');
      expect(result.current.ideas).toHaveLength(1);
    });

    it('sets loading true while fetching', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          ideas: [],
          total_count: 0,
          generated_at: '' 
        }) 
      };

      const deferred = {
        promise: null as Promise<unknown> | null,
        resolve: null as ((value: unknown) => void) | null
      };

      deferred.promise = new Promise(resolve => {
        deferred.resolve = resolve;
      });

      mockAuthenticatedFetch.mockImplementation(() => deferred.promise as Promise<unknown>);

      const { result } = renderHook(() => useContentStudio());

      act(() => { result.current.fetchIdeas(); });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.resolve?.(mockResponse);
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('sets error when fetch fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

      const { result } = renderHook(() => useContentStudio());

      await act(async () => {
        await result.current.fetchIdeas();
      });

      expect(result.current.error).toBeTruthy();
    });
  });

  describe('fetchHistory', () => {
    it('fetches and returns content history', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useContentStudio());

      await act(async () => {
        await result.current.fetchHistory();
      });

      expect(result.current.history).toHaveLength(2);
      expect(result.current.unviewedCount).toBe(1);
    });

    it('includes limit in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useContentStudio());

      await act(async () => {
        await result.current.fetchHistory(50);
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=50');
    });
  });

  describe('generateContent', () => {
    it('generates content and returns result', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useContentStudio());

      const holder: { value: GenerateResult | null } = { value: null };
      await act(async () => {
        holder.value = await result.current.generateContent(mockContentIdea);
      });

      expect(holder.value?.success).toBe(true);
      expect(holder.value?.id).toBe('new-content-1');
    });

    it('sets generating false after completion', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useContentStudio());

      await act(async () => {
        await result.current.generateContent(mockContentIdea);
      });

      expect(result.current.generating).toBe(false);
    });

    it('returns null when generation fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFailGenerate: true }));

      const { result } = renderHook(() => useContentStudio());

      const mutations = { generateResult: undefined as unknown };
      await act(async () => {
        mutations.generateResult = await result.current.generateContent(mockContentIdea);
      });

      expect(mutations.generateResult).toBeNull();
    });
  });

  describe('markViewed', () => {
    it('returns true when mark viewed succeeds', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useContentStudio());

      const mutations = { success: false };
      await act(async () => {
        mutations.success = await result.current.markViewed('content-1');
      });

      expect(mutations.success).toBe(true);
    });

    it('returns false when mark viewed fails', async () => {
      const mockFailResponse = {
        ok: false,
        status: 500 
      };
      mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(mockFailResponse));

      const { result } = renderHook(() => useContentStudio());

      const mutations = { success: false };
      await act(async () => {
        mutations.success = await result.current.markViewed('content-1');
      });

      expect(mutations.success).toBe(false);
    });
  });

  describe('deleteContent', () => {
    it('returns true when delete succeeds', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useContentStudio());

      const mutations = { success: false };
      await act(async () => {
        mutations.success = await result.current.deleteContent('content-1');
      });

      expect(mutations.success).toBe(true);
    });

    it('returns false when delete fails', async () => {
      const mockFailResponse = {
        ok: false,
        status: 500 
      };
      mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(mockFailResponse));

      const { result } = renderHook(() => useContentStudio());

      const mutations = { success: true };
      await act(async () => {
        mutations.success = await result.current.deleteContent('content-1');
      });

      expect(mutations.success).toBe(false);
    });
  });

  describe('refreshGeneratingItems', () => {
    it('is a callable function', () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useContentStudio());

      expect(typeof result.current.refreshGeneratingItems).toBe('function');
    });
  });
});
