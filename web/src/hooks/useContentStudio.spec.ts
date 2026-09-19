import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useContentStudio } from './useContentStudio';
import {
  mockContentIdea, createMockFetch 
} from './useContentStudio-fixtures';
import {
  createDeferredResponse, createMockJsonResponse 
} from '../test/fetchResponses';

interface GenerateResult {
  success: boolean;
  id: string;
}

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

type ContentStudioHook = ReturnType<typeof useContentStudio>;

/** The two boolean-returning mutations, so their success and failure paths share one table. */
const mutationOperations: [operation: string, run: (hook: ContentStudioHook) => Promise<boolean>][] = [
  ['markViewed', (hook) => hook.markViewed('content-1')],
  ['deleteContent', (hook) => hook.deleteContent('content-1')],
];

describe('useContentStudio', () => {
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
      const deferred = createDeferredResponse();
      mockAuthenticatedFetch.mockImplementation(() => deferred.promise);

      const { result } = renderHook(() => useContentStudio());

      act(() => { result.current.fetchIdeas(); });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.resolve(createMockJsonResponse({
          ideas: [],
          total_count: 0,
          generated_at: '' 
        }));
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

  describe('markViewed and deleteContent', () => {
    it.each(mutationOperations)('%s resolves true when the server accepts the request', async (_operation, run) => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());
      const { result } = renderHook(() => useContentStudio());

      const success = await act(() => run(result.current));

      expect(success).toBe(true);
    });

    it.each(mutationOperations)('%s resolves false when the server rejects the request', async (_operation, run) => {
      mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 500));
      const { result } = renderHook(() => useContentStudio());

      const success = await act(() => run(result.current));

      expect(success).toBe(false);
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
