import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import type {
  ContentBriefBatchStartResponse,
  GenerateContentResponse,
} from '../types';
import {
  batchStatusRequestUrls,
  buildContentHistoryPayload,
  buildRunningBatchStatusResponse,
  buildTerminalBatchStartResponse,
  createMockFetch,
  mockBatchRequest,
  mockBatchStartResponse,
  mockContentHistory,
  mockContentIdea,
  renderContentStudio,
  storedActiveContentStudioBatchIds,
} from './useContentStudio-fixtures';
import {
  renderReplayedBatchStart,
  renderReplayedGenerationStart,
  renderReplayedHistoryLoad,
} from './useContentStudio-strict-fixtures';
import {
  prepareContentStudioHookTest,
  queueContentStudioPayloads,
  queueTwoDeferredContentStudioRequests,
  restoreContentStudioHookTest,
  settleDeferredJson,
} from './useContentStudio-test-fixtures';
import { startTwoOverlappingCalls } from './useContentStudio-request-fixtures';
import {
  buildStartedGenerationResponse,
  generationState,
  renderPendingBatchStart,
  startOverlappingHistoryLoads,
} from './useContentStudio-scenario-fixtures';
import { useContentStudio } from './useContentStudio';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const declinedBatchCases = [
  {
    testName: 'reports the backend message when a decoded batch is declined',
    response: {
      ...mockBatchStartResponse,
      success: false,
      error: 'Batch was not accepted',
    },
    expectedError: 'Batch was not accepted',
  },
  {
    testName: 'preserves null error when a declined batch omits a message',
    response: {
      ...mockBatchStartResponse,
      success: false,
    },
    expectedError: null,
  },
];

beforeEach(prepareContentStudioHookTest);
afterEach(restoreContentStudioHookTest);

describe('useContentStudio StrictMode replay lifecycle', () => {
  it('finishes the replayed history load while the discarded load is pending', async () => {
    const {
      firstRequest,
      secondRequest,
      fetch,
      rendered,
    } = renderReplayedHistoryLoad();
    const newerHistory = [{
      ...mockContentHistory[0],
      id: 'content-newer',
    }];

    await act(() => settleDeferredJson(secondRequest, buildContentHistoryPayload(newerHistory)));

    expect({
      historyIds: rendered.result.current.history.map((item) => item.id),
      loading: rendered.result.current.loading,
    }).toStrictEqual({
      historyIds: ['content-newer'],
      loading: false,
    });
    await act(() => settleDeferredJson(firstRequest, buildContentHistoryPayload(mockContentHistory)));
    expect(rendered.result.current.history.map((item) => item.id))
      .toStrictEqual(['content-newer']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('finishes the replayed generation start while the discarded start is pending', async () => {
    const {
      firstRequest,
      secondRequest,
      fetch,
      rendered,
    } = renderReplayedGenerationStart();

    await act(() => settleDeferredJson(
      secondRequest,
      buildStartedGenerationResponse('content-newer')
    ));

    expect(rendered.result.current.generating).toBe(false);
    await act(() => settleDeferredJson(
      firstRequest,
      buildStartedGenerationResponse('content-discarded')
    ));
    expect(rendered.result.current.generating).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores the discarded batch response while replay remains pending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const {
      firstRequest,
      secondRequest,
      fetch,
      rendered,
    } = renderReplayedBatchStart();
    await act(() => settleDeferredJson(firstRequest, buildTerminalBatchStartResponse('batch-1')));

    expect({
      activeBatches: rendered.result.current.activeBatches,
      generating: rendered.result.current.generating,
    }).toStrictEqual({
      activeBatches: [],
      generating: true,
    });
    await act(() => settleDeferredJson(secondRequest, buildTerminalBatchStartResponse('batch-1')));
    expect(storedActiveContentStudioBatchIds()).toStrictEqual([]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe('useContentStudio history read lifecycle', () => {
  it('keeps loading true until every overlapping history request settles', async () => {
    const {
      loads, olderRequest, result
    } = startOverlappingHistoryLoads();

    await act(() => loads.second);

    expect(result.current.loading).toBe(true);
    olderRequest.resolve(createMockJsonResponse(buildContentHistoryPayload(mockContentHistory)));
    const staleResult = await act(() => loads.first);
    expect(staleResult).toStrictEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('clears an earlier history error while a retry is pending', async () => {
    const retryRequest = createDeferredResponse();
    queueContentStudioPayloads(createMockJsonResponse({}, 500), retryRequest.promise);
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const {
      result, unmount
    } = renderHook(() => useContentStudio());
    await act(() => result.current.fetchHistory());

    act(() => { void result.current.fetchHistory(); });

    expect({
      error: result.current.error,
      loading: result.current.loading,
    }).toStrictEqual({
      error: null,
      loading: true,
    });
    unmount();
    await settleDeferredJson(retryRequest, buildContentHistoryPayload([]));
  });

  it('returns an empty result with the exact current history error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 500));
    const { result } = renderHook(() => useContentStudio());

    const received = await act(() => result.current.fetchHistory());

    expect(received).toStrictEqual([]);
    expect(result.current.error).toBe('Content generation failed');
    expect(consoleError).toHaveBeenCalledWith(
      '[content] Error fetching history:',
      expect.objectContaining({ statusCode: 500 })
    );
  });

  it('ignores an older history failure after a newer request succeeds', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const {
      loads, olderRequest, result
    } = startOverlappingHistoryLoads();
    await act(() => loads.second);

    olderRequest.reject(new TypeError('Older request lost connection'));
    const staleResult = await act(() => loads.first);

    expect(staleResult).toStrictEqual([]);
    expect(result.current.history.map((item) => item.id)).toStrictEqual(['content-1']);
    expect(consoleError).toHaveBeenCalledTimes(0);
  });
});

describe('useContentStudio generation request lifecycle', () => {
  it('reports exact error state when a combined generation start fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const { result } = renderContentStudio(
      createMockFetch({ shouldFailGenerate: true })
    );

    const received = await act(() => result.current.generateContent(mockContentIdea));

    expect({
      received,
      error: result.current.error,
      generating: result.current.generating,
    }).toStrictEqual({
      received: null,
      error: 'Content generation failed',
      generating: false,
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[content] Error starting content generation:',
      expect.objectContaining({ statusCode: 500 })
    );
  });

  it('does not let an older combined failure overwrite a newer request', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const deferredStarts = queueTwoDeferredContentStudioRequests();
    const { result } = renderHook(() => useContentStudio());
    const pendingStarts = startTwoOverlappingCalls<GenerateContentResponse | null>(
      () => result.current.generateContent(mockContentIdea),
      null
    );

    deferredStarts.olderRequest.resolve(createMockJsonResponse({}, 500));
    await act(() => pendingStarts.first);

    expect(generationState(result.current)).toStrictEqual({
      error: null,
      generating: true,
    });
    deferredStarts.newerRequest.resolve(createMockJsonResponse(
      buildStartedGenerationResponse('content-newer')
    ));
    await act(() => pendingStarts.second);
  });

  it.each(declinedBatchCases)('$testName', async ({
    response, expectedError
  }) => {
    const fetch = createMockFetch({ batchStartResponse: response });
    const { result } = renderContentStudio(fetch);

    await act(() => result.current.generateContentBatch(mockBatchRequest));

    expect(result.current.error).toBe(expectedError);
    expect(storedActiveContentStudioBatchIds()).toStrictEqual([]);
  });

  it('retains the pre-POST candidate when an accepted response settles after unmount', async () => {
    const request = createDeferredResponse();
    queueContentStudioPayloads(request.promise);
    const {
      result, unmount
    } = renderPendingBatchStart();

    unmount();
    await settleDeferredJson(request, mockBatchStartResponse);

    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-1']);
    expect(result.current.activeBatches).toStrictEqual([]);
  });

  it('recovers a batch after its network-ambiguous start failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockAuthenticatedFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const firstRender = renderHook(() => useContentStudio());

    await act(() => firstRender.result.current.generateContentBatch(mockBatchRequest));
    firstRender.unmount();

    const fetch = createMockFetch({ batchStatusResponse: buildRunningBatchStatusResponse() });
    const secondRender = renderContentStudio(fetch);
    await waitFor(() => {
      expect(secondRender.result.current.activeBatches).toStrictEqual([
        buildRunningBatchStatusResponse()
      ]);
    });

    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-1']);
    expect(batchStatusRequestUrls(fetch)).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith(
      '[content] Error starting Content Brief batch:',
      expect.any(TypeError)
    );
  });

  it('retains the candidate when a batch start is aborted ambiguously', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockAuthenticatedFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    const { result } = renderHook(() => useContentStudio());
    const responses: (ContentBriefBatchStartResponse | null)[] = [];

    await act(async () => {
      responses.push(await result.current.generateContentBatch(mockBatchRequest));
    });

    expect(responses).toStrictEqual([null]);
    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-1']);
  });

  it('removes the candidate when a structured client rejection is definitive', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      error: 'Batch conflicts with an existing request',
      field: 'batch_id',
    }, 409));
    const { result } = renderHook(() => useContentStudio());

    const received = await act(() => result.current.generateContentBatch(mockBatchRequest));

    expect(received).toBeNull();
    expect(result.current.error).toBe('Batch conflicts with an existing request');
    expect(storedActiveContentStudioBatchIds()).toStrictEqual([]);
  });

  it('retains the candidate when an unstructured client response is ambiguous', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(
      createMockJsonResponse('Bad request', 400, 'Bad Request')
    );
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const { pendingStart } = renderPendingBatchStart();

    await act(() => pendingStart);

    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-1']);
  });

  it('logs exact batch context and retains its candidate when a 5xx start fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const { result } = renderContentStudio(
      createMockFetch({ shouldFailBatchStart: true })
    );

    await act(() => result.current.generateContentBatch(mockBatchRequest));

    expect(generationState(result.current)).toStrictEqual({
      error: 'Content generation failed',
      generating: false,
    });
    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-1']);
    expect(consoleError).toHaveBeenCalledWith(
      '[content] Error starting Content Brief batch:',
      expect.objectContaining({ statusCode: 500 })
    );
  });
});
