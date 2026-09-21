import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import { act } from '@testing-library/react';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import type {
  ContentStatus, ContentStudioHistory
} from '../types';
import {
  buildContentHistoryPayload,
  createMockFetch,
  mockContentHistory,
  renderContentStudio,
} from './useContentStudio-fixtures';
import {
  contentStatusPayload,
  contentStudioRequestUrls,
  historyItemWithStatus,
  prepareContentStudioHookTest,
  queueContentStudioPayloads,
  queueContentStudioResponses,
  renderFetchedContentStudio,
  renderPendingItemStatus,
  restoreContentStudioHookTest,
  settleDeferredJson,
  waitForContentStudioRequests,
} from './useContentStudio-test-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const terminalStatuses = [
  'generated', 'failed'
] satisfies readonly ContentStatus[];

beforeEach(prepareContentStudioHookTest);
afterEach(restoreContentStudioHookTest);

describe('useContentStudio single-item polling', () => {
  it.each(terminalStatuses)(
    'refreshes history when one non-batch item becomes %s',
    async (status) => {
      queueContentStudioPayloads(
        buildContentHistoryPayload([mockContentHistory[1]]),
        contentStatusPayload('content-2', status),
        buildContentHistoryPayload([
          historyItemWithStatus(mockContentHistory[1], status)
        ])
      );

      const { result } = await renderFetchedContentStudio();
      await waitForContentStudioRequests(3);

      expect(result.current.history[0]?.status).toBe(status);
      expect(contentStudioRequestUrls('/history')).toHaveLength(2);
    }
  );

  it('refreshes history when any of several non-batch items completes', async () => {
    const generatingHistory: ContentStudioHistory[] = [
      {
        ...mockContentHistory[0],
        status: 'generating',
        generated_content: undefined,
      },
      mockContentHistory[1],
    ];
    const completedHistory = generatingHistory.map((item) => (
      historyItemWithStatus(item, 'generated')
    ));
    queueContentStudioPayloads(
      buildContentHistoryPayload(generatingHistory),
      contentStatusPayload('content-1', 'generated'),
      contentStatusPayload('content-2', 'generating'),
      buildContentHistoryPayload(completedHistory)
    );

    const { result } = await renderFetchedContentStudio();
    await waitForContentStudioRequests(4);

    expect(result.current.history.map((item) => item.status)).toStrictEqual([
      'generated', 'generated'
    ]);
    expect(contentStudioRequestUrls('/history')).toHaveLength(2);
  });

  it('keeps history unchanged when a status request fails', async () => {
    queueContentStudioResponses(
      createMockJsonResponse(buildContentHistoryPayload([mockContentHistory[1]])),
      createMockJsonResponse({}, 500)
    );

    const { result } = await renderFetchedContentStudio();
    await waitForContentStudioRequests(2);

    expect(result.current.history[0]?.status).toBe('generating');
    expect(contentStudioRequestUrls('/history')).toHaveLength(1);
  });

  it('does not refresh history for a pending-to-generating transition', async () => {
    const pendingItem = historyItemWithStatus(mockContentHistory[1], 'pending');
    queueContentStudioPayloads(
      buildContentHistoryPayload([pendingItem]),
      contentStatusPayload('content-2', 'generating')
    );

    await renderFetchedContentStudio();
    await waitForContentStudioRequests(2);

    expect(contentStudioRequestUrls('/history')).toHaveLength(1);
  });

  it('polls an ordinary pending history row', async () => {
    const pendingItem: ContentStudioHistory = {
      ...mockContentHistory[1],
      id: 'content-pending',
      status: 'pending',
    };
    queueContentStudioPayloads(
      buildContentHistoryPayload([pendingItem]),
      contentStatusPayload('content-pending', 'pending')
    );

    await renderFetchedContentStudio();
    await waitForContentStudioRequests(2);

    expect(contentStudioRequestUrls('/status/content-pending')).toHaveLength(1);
  });

  it('does not poll an ordinary terminal history row', async () => {
    const terminalItem = historyItemWithStatus(mockContentHistory[1], 'generated');
    const historyResponse = buildContentHistoryPayload([terminalItem]);
    const { result } = renderContentStudio(createMockFetch({ historyResponse }));

    await act(() => result.current.fetchHistory());

    expect(contentStudioRequestUrls('/status/')).toStrictEqual([]);
  });

  it('requests status only for independently generating history rows', async () => {
    const batchItem: ContentStudioHistory = {
      ...mockContentHistory[1],
      id: 'content-batch',
      batch_id: 'batch-1',
    };
    queueContentStudioPayloads(
      buildContentHistoryPayload([
        mockContentHistory[1],
        batchItem,
        historyItemWithStatus(mockContentHistory[0], 'generated'),
      ]),
      contentStatusPayload('content-2', 'generating')
    );

    await renderFetchedContentStudio();
    await waitForContentStudioRequests(2);

    expect(contentStudioRequestUrls('/status/')).toStrictEqual([
      'https://api.test.com/content-studio/status/content-2'
    ]);
  });

  it('aborts the pending item poll and issues one replacement when refreshed', async () => {
    const {
      rendered, statusRequest
    } = await renderPendingItemStatus();
    const replacementStatus = createDeferredResponse();
    mockAuthenticatedFetch.mockReturnValueOnce(replacementStatus.promise);

    act(() => rendered.result.current.refreshGeneratingItems());

    const pendingSignal = mockAuthenticatedFetch.mock.calls[1]?.[1]?.signal;
    expect(pendingSignal?.aborted).toBe(true);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(3);
    rendered.unmount();
    await settleDeferredJson(
      statusRequest,
      contentStatusPayload('content-2', 'generating')
    );
    await settleDeferredJson(
      replacementStatus,
      contentStatusPayload('content-2', 'generating')
    );
  });

  it('clears the item polling interval when the hook unmounts', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const {
      rendered, statusRequest
    } = await renderPendingItemStatus();
    const callsBeforeUnmount = clearIntervalSpy.mock.calls.length;

    rendered.unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(callsBeforeUnmount + 1);
    await settleDeferredJson(
      statusRequest,
      contentStatusPayload('content-2', 'generating')
    );
  });

  it('does not refresh history after terminal status settles post-unmount', async () => {
    const {
      rendered, statusRequest
    } = await renderPendingItemStatus();

    rendered.unmount();
    await act(() => settleDeferredJson(
      statusRequest,
      contentStatusPayload('content-2', 'generated')
    ));

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale item status that settles after polling was restarted', async () => {
    const staleStatus = createDeferredResponse();
    const currentStatus = createDeferredResponse();
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse(
        buildContentHistoryPayload([mockContentHistory[1]])
      ))
      .mockReturnValueOnce(staleStatus.promise)
      .mockResolvedValueOnce(createMockJsonResponse(
        buildContentHistoryPayload([mockContentHistory[1]])
      ))
      .mockReturnValueOnce(currentStatus.promise);
    const rendered = await renderFetchedContentStudio();
    await waitForContentStudioRequests(2);
    await act(() => rendered.result.current.fetchHistory());
    await waitForContentStudioRequests(4);

    await act(() => settleDeferredJson(
      staleStatus,
      contentStatusPayload('content-2', 'generated')
    ));

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(4);
    rendered.unmount();
    await settleDeferredJson(
      currentStatus,
      contentStatusPayload('content-2', 'generating')
    );
  });

  it('requests another item status when the ten-second interval elapses', async () => {
    vi.useFakeTimers();
    const fetch = createMockFetch({
      historyResponse: buildContentHistoryPayload([mockContentHistory[1]]),
      statusResponse: contentStatusPayload('content-2', 'generating'),
    });
    const {
      result, unmount
    } = renderContentStudio(fetch);
    await act(() => result.current.fetchHistory());
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(contentStudioRequestUrls('/status/')).toHaveLength(2);
    unmount();
  });
});
