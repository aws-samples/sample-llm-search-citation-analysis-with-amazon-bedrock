import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useContentStudio } from './useContentStudio';
import {
  mockContentIdea, createMockFetch, renderContentStudio 
} from './useContentStudio-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';

interface GenerateResult {
  success: boolean;
  id: string;
}

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import {
  deferAuthenticatedFetch, mockAuthenticatedFetch 
} from '../test/infrastructureMock';

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
      const { result } = renderContentStudio();

      const mutations = { ideas: [] as typeof mockContentIdea[] };
      await act(async () => {
        mutations.ideas = await result.current.fetchIdeas();
      });

      expect(mutations.ideas).toHaveLength(1);
      expect(mutations.ideas[0].keyword).toBe('best hotels');
      expect(result.current.ideas).toHaveLength(1);
    });

    it('sets loading true while fetching', async () => {
      const deferred = deferAuthenticatedFetch();

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

    it('sets the content server-error message when the fetch fails', async () => {
      const { result } = renderContentStudio(createMockFetch({ shouldFail: true }));

      await act(async () => {
        await result.current.fetchIdeas();
      });

      expect(result.current.error).toBe('Content generation failed');
    });
  });

  describe('fetchHistory', () => {
    it('fetches and returns content history', async () => {
      const { result } = renderContentStudio();

      await act(async () => {
        await result.current.fetchHistory();
      });

      expect(result.current.history).toHaveLength(2);
      expect(result.current.unviewedCount).toBe(1);
    });

    it('includes limit in URL params', async () => {
      const { result } = renderContentStudio();

      await act(async () => {
        await result.current.fetchHistory(50);
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=50');
    });
  });

  describe('generateContent', () => {
    it('generates content and returns result', async () => {
      const { result } = renderContentStudio();

      const holder: { value: GenerateResult | null } = { value: null };
      await act(async () => {
        holder.value = await result.current.generateContent(mockContentIdea);
      });

      expect(holder.value?.success).toBe(true);
      expect(holder.value?.id).toBe('new-content-1');
    });

    it('sets generating false after completion', async () => {
      const { result } = renderContentStudio();

      await act(async () => {
        await result.current.generateContent(mockContentIdea);
      });

      expect(result.current.generating).toBe(false);
    });

    it('returns null when generation fails', async () => {
      const { result } = renderContentStudio(createMockFetch({ shouldFailGenerate: true }));

      const mutations = { generateResult: undefined as unknown };
      await act(async () => {
        mutations.generateResult = await result.current.generateContent(mockContentIdea);
      });

      expect(mutations.generateResult).toBeNull();
    });
  });

  describe('markViewed and deleteContent', () => {
    it.each(mutationOperations)('%s resolves true when the server accepts the request', async (_operation, run) => {
      const { result } = renderContentStudio();

      const success = await act(() => run(result.current));

      expect(success).toBe(true);
    });

    it.each(mutationOperations)('%s resolves false when the server rejects the request', async (_operation, run) => {
      const { result } = renderContentStudio(vi.fn().mockResolvedValue(createMockJsonResponse({}, 500)));

      const success = await act(() => run(result.current));

      expect(success).toBe(false);
    });
  });

  describe('refreshGeneratingItems', () => {
    it('is a callable function', () => {
      const { result } = renderContentStudio();

      expect(typeof result.current.refreshGeneratingItems).toBe('function');
    });
  });
});
