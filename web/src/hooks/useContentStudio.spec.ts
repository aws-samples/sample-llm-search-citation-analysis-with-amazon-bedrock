import {
  afterEach, beforeEach, describe, it, expect, vi
} from 'vitest';
import {
  renderHook, waitFor, act
} from '@testing-library/react';
import { useContentStudio } from './useContentStudio';
import {
  buildPollingHistoryItem,
  countContentHistoryRequests,
  countContentStatusRequests,
  createMockFetch,
  mockContentHistory,
  mockContentIdea,
  renderContentStudio,
  renderContentStudioAfterStatusFailureLimit,
  renderContentStudioWithDeferredPolling,
  settleDeferredStatusBatch,
  setupContentStudioConsoleErrorMock,
  type StatusFailure,
  unmountContentStudioWithActiveStatusRequest
} from './useContentStudio-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';

interface GenerateResult {
  success: boolean;
  id: string;
  status: string;
  keyword: string;
}

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import {
  deferAuthenticatedFetch, mockAuthenticatedFetch
} from '../test/infrastructureMock';

type ContentStudioHook = ReturnType<typeof useContentStudio>;

const mutationOperations: [operation: string, run: (hook: ContentStudioHook) => Promise<boolean>][] = [
  ['markViewed', (hook) => hook.markViewed('content-1')],
  ['deleteContent', (hook) => hook.deleteContent('content-1')],
];

const statusFailures: [label: string, failure: StatusFailure][] = [
  ['HTTP', 'http'],
  ['network', 'network'],
  ['invalid-response', 'invalid'],
];

describe('useContentStudio', () => {
  beforeEach(setupContentStudioConsoleErrorMock);

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('returns no ideas when initialized', () => {
      const { result } = renderHook(() => useContentStudio());
      expect(result.current.ideas).toStrictEqual([]);
    });

    it('returns no history when initialized', () => {
      const { result } = renderHook(() => useContentStudio());
      expect(result.current.history).toStrictEqual([]);
    });

    it('returns zero unviewed count when initialized', () => {
      const { result } = renderHook(() => useContentStudio());
      expect(result.current.unviewedCount).toBe(0);
    });

    it('returns idle loading state when initialized', () => {
      const { result } = renderHook(() => useContentStudio());
      expect(result.current.loading).toBe(false);
    });
  });

  describe('fetchIdeas', () => {
    it('synchronizes exact content ideas when the request succeeds', async () => {
      const { result } = renderContentStudio();
      const receivedIdeas: { value: (typeof mockContentIdea)[] } = { value: [] };

      await act(async () => {
        receivedIdeas.value = await result.current.fetchIdeas();
      });

      expect({
        returnedIdeas: receivedIdeas.value,
        storedIdeas: result.current.ideas,
      }).toStrictEqual({
        returnedIdeas: [mockContentIdea],
        storedIdeas: [mockContentIdea],
      });
    });

    it('reports the exact loading lifecycle when an ideas request settles', async () => {
      const deferred = deferAuthenticatedFetch();
      const { result } = renderHook(() => useContentStudio());

      act(() => { void result.current.fetchIdeas(); });
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

    it('returns the content server-error message when the ideas request fails', async () => {
      const { result } = renderContentStudio(createMockFetch({ shouldFail: true }));

      await act(async () => {
        await result.current.fetchIdeas();
      });

      expect(result.current.error).toBe('Content generation failed');
    });
  });

  describe('fetchHistory', () => {
    it('stores exact history state when the history request succeeds', async () => {
      const { result } = renderContentStudio();

      await act(async () => {
        await result.current.fetchHistory();
      });

      expect({
        history: result.current.history,
        unviewedCount: result.current.unviewedCount,
      }).toStrictEqual({
        history: mockContentHistory,
        unviewedCount: 1,
      });
    });

    it('uses the exact history URL when a custom limit is given', async () => {
      const { result } = renderContentStudio();

      await act(async () => {
        await result.current.fetchHistory(50);
      });

      const [requestedUrl] = mockAuthenticatedFetch.mock.calls[0];
      expect(requestedUrl).toBe('https://api.test.com/content-studio/history?limit=50');
    });
  });

  describe('generateContent', () => {
    it('returns the exact generation result when generation succeeds', async () => {
      const generationResult: { value: GenerateResult | null } = { value: null };
      const { result } = renderContentStudio();

      await act(async () => {
        generationResult.value = await result.current.generateContent(mockContentIdea);
      });

      expect(generationResult.value).toStrictEqual({
        success: true,
        id: 'new-content-1',
        status: 'pending',
        keyword: 'test',
      });
    });

    it('returns idle generation state when generation completes', async () => {
      const { result } = renderContentStudio();

      await act(async () => {
        await result.current.generateContent(mockContentIdea);
      });

      expect(result.current.generating).toBe(false);
    });

    it('returns null when generation fails', async () => {
      const generationResult: { value: GenerateResult | null | undefined } = { value: undefined };
      const { result } = renderContentStudio(createMockFetch({ shouldFailGenerate: true }));

      await act(async () => {
        generationResult.value = await result.current.generateContent(mockContentIdea);
      });

      expect(generationResult.value).toBeNull();
    });
  });

  describe('markViewed and deleteContent', () => {
    it.each(mutationOperations)('%s resolves true when the server accepts the request', async (_operation, run) => {
      const { result } = renderContentStudio();

      const success = await act(() => run(result.current));

      expect(success).toBe(true);
    });

    it.each(mutationOperations)('%s resolves false when the server rejects the request', async (_operation, run) => {
      const { result } = renderContentStudio(
        vi.fn().mockResolvedValue(createMockJsonResponse({}, 500))
      );

      const success = await act(() => run(result.current));

      expect(success).toBe(false);
    });
  });

  describe('status polling', () => {
    it.each(statusFailures)(
      'exposes a visible error after three consecutive %s status failures',
      async (_label, statusFailure) => {
        const {
          result, unmount
        } = await renderContentStudioAfterStatusFailureLimit(statusFailure);

        expect(result.current.error).toBe(
          'Unable to check content generation status after 3 attempts. Refresh to try again.'
        );
        unmount();
      }
    );

    it('stops requesting status when an item reaches three consecutive failures', async () => {
      const { unmount } = await renderContentStudioAfterStatusFailureLimit('network');
      const callsAtFailureLimit = countContentStatusRequests();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(callsAtFailureLimit).toBe(3);
      expect(countContentStatusRequests()).toBe(3);
      unmount();
    });

    it('keeps one status request in flight when multiple polling intervals elapse', async () => {
      const {
        deferredStatusFetch, unmount
      } = await renderContentStudioWithDeferredPolling([[
        buildPollingHistoryItem('content-a'),
      ]]);
      expect(deferredStatusFetch.statusRequests).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(deferredStatusFetch.statusRequests).toHaveLength(1);
      unmount();
    });

    it('preserves newer successful status when a superseded request fails later', async () => {
      const generatingItem = buildPollingHistoryItem('content-a');
      const generatedItem = buildPollingHistoryItem('content-a', 'generated');
      const {
        deferredStatusFetch, result, unmount
      } = await renderContentStudioWithDeferredPolling([
        [generatingItem],
        [generatedItem],
      ]);
      const initialRequest = deferredStatusFetch.statusRequests[0];
      act(() => result.current.refreshGeneratingItems());
      const replacementRequest = deferredStatusFetch.statusRequests[1];

      await act(async () => {
        replacementRequest.response.resolve(createMockJsonResponse({
          id: 'content-a',
          status: 'generated',
        }));
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        initialRequest.response.reject(new TypeError('Stale network failure'));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(initialRequest.signal?.aborted).toBe(true);
      expect(result.current.history.map((item) => item.status)).toStrictEqual(['generated']);
      expect(result.current.error).toBeNull();
      expect(deferredStatusFetch.statusRequests).toHaveLength(2);
      unmount();
    });

    it('stops polling with exact local terminal state when terminal history refresh fails', async () => {
      vi.useFakeTimers();
      const generatingItem = buildPollingHistoryItem('content-a');
      const generatedItem = buildPollingHistoryItem('content-a', 'generated');
      const {
        result, unmount
      } = renderContentStudio(createMockFetch({
        historyResponse: {
          history: [generatingItem],
          total_count: 1,
          unviewed_count: 0,
        },
        historyRefreshFailureDelayMs: 1,
      }));

      await act(async () => {
        await result.current.fetchHistory();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const beforeRefreshFailure = {
        history: result.current.history,
        statusRequests: countContentStatusRequests(),
        historyRequests: countContentHistoryRequests(),
      };

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_001);
      });

      expect({
        beforeRefreshFailure,
        afterRefreshFailure: {
          history: result.current.history,
          error: result.current.error,
          statusRequests: countContentStatusRequests(),
          historyRequests: countContentHistoryRequests(),
        },
      }).toStrictEqual({
        beforeRefreshFailure: {
          history: [generatedItem],
          statusRequests: 1,
          historyRequests: 2,
        },
        afterRefreshFailure: {
          history: [generatedItem],
          error: 'Content generation failed',
          statusRequests: 1,
          historyRequests: 2,
        },
      });
      unmount();
    });

    it('retains a terminal update when another item status request fails', async () => {
      const firstItem = buildPollingHistoryItem('content-a');
      const secondItem = buildPollingHistoryItem('content-b');
      const generatedFirstItem = buildPollingHistoryItem('content-a', 'generated');
      const {
        deferredStatusFetch, result, unmount
      } = await renderContentStudioWithDeferredPolling([
        [firstItem, secondItem],
        [generatedFirstItem, secondItem],
      ]);

      await settleDeferredStatusBatch(
        deferredStatusFetch.statusRequests,
        ['generated', 'network-failure']
      );

      expect(result.current.history.map((item) => [item.id, item.status])).toStrictEqual([
        ['content-a', 'generated'],
        ['content-b', 'generating'],
      ]);
      expect(countContentHistoryRequests()).toBe(2);
      expect(result.current.error).toBeNull();
      unmount();
    });

    it('keeps the retry warning when a third item failure accompanies a terminal update', async () => {
      const firstItem = buildPollingHistoryItem('content-a');
      const secondItem = buildPollingHistoryItem('content-b');
      const generatedSecondItem = buildPollingHistoryItem('content-b', 'generated');
      const {
        deferredStatusFetch, result, unmount
      } = await renderContentStudioWithDeferredPolling([
        [firstItem, secondItem],
        [firstItem, generatedSecondItem],
      ]);

      await settleDeferredStatusBatch(
        deferredStatusFetch.statusRequests.slice(0, 2),
        ['network-failure', 'generating']
      );
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      await settleDeferredStatusBatch(
        deferredStatusFetch.statusRequests.slice(2, 4),
        ['network-failure', 'generating']
      );
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      await settleDeferredStatusBatch(
        deferredStatusFetch.statusRequests.slice(4, 6),
        ['network-failure', 'generated']
      );

      expect(result.current.error).toBe(
        'Unable to check content generation status after 3 attempts. Refresh to try again.'
      );
      expect(result.current.history.map((item) => item.status)).toStrictEqual([
        'generating',
        'generated',
      ]);
      expect(countContentStatusRequests('content-a')).toBe(3);
      expect(countContentStatusRequests('content-b')).toBe(3);
      unmount();
    });

    it('continues polling healthy items when another item reaches its failure limit', async () => {
      vi.useFakeTimers();
      const firstItem = buildPollingHistoryItem('content-a');
      const secondItem = buildPollingHistoryItem('content-b');
      const {
        result, unmount
      } = renderContentStudio(createMockFetch({
        historyResponse: {
          history: [firstItem, secondItem],
          total_count: 2,
          unviewed_count: 0,
        },
        statusFailures: { 'content-a': 'network' },
        statusResponses: {
          'content-b': {
            id: 'content-b',
            status: 'generating'
          },
        },
      }));

      await act(async () => {
        await result.current.fetchHistory();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40_000);
      });

      expect(countContentStatusRequests('content-a')).toBe(3);
      expect(countContentStatusRequests('content-b')).toBe(5);
      unmount();
    });

    it('aborts the active status request when the hook unmounts', async () => {
      const { activeRequest } = await unmountContentStudioWithActiveStatusRequest();

      expect(activeRequest.signal?.aborted).toBe(true);
    });

    it('ignores a stale status completion when the hook is unmounted', async () => {
      const {
        activeRequest, deferredStatusFetch
      } = await unmountContentStudioWithActiveStatusRequest();
      await act(async () => {
        activeRequest.response.resolve(createMockJsonResponse({
          id: 'content-a',
          status: 'generated',
        }));
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(countContentHistoryRequests()).toBe(1);
      expect(deferredStatusFetch.statusRequests).toHaveLength(1);
      expect(console.error).toHaveBeenCalledTimes(0);
    });

    it('clears the polling interval when the hook unmounts', async () => {
      const { unmount } = await renderContentStudioWithDeferredPolling([[
        buildPollingHistoryItem('content-a'),
      ]]);
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const callsBeforeUnmount = clearIntervalSpy.mock.calls.length;
      unmount();

      expect(clearIntervalSpy).toHaveBeenCalledTimes(callsBeforeUnmount + 1);
      clearIntervalSpy.mockRestore();
    });
  });

  describe('refreshGeneratingItems', () => {
    it('retries an exhausted item when manual refresh resets failure accounting', async () => {
      const {
        result, unmount
      } = await renderContentStudioAfterStatusFailureLimit('network');

      act(() => result.current.refreshGeneratingItems());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(countContentStatusRequests()).toBe(4);
      expect(result.current.error).toBeNull();
      unmount();
    });
  });
});
