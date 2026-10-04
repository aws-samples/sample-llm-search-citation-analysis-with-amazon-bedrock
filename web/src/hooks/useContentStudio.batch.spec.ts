import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, waitFor
} from '@testing-library/react';
import { buildBatchCandidate } from '../api/contentStudioBatchStorage-fixtures';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import {
  batchStatusRequestUrls,
  buildGeneratingBatchStartResponse,
  buildRunningBatchStatusResponse,
  buildTerminalBatchStartResponse,
  createMockFetch,
  mockBatchRequest,
  mockBatchStartResponse,
  renderConcurrentBatchStarts,
  renderContentStudio,
  renderContentStudioInStrictMode,
  storedActiveContentStudioBatchCandidates,
  storedActiveContentStudioBatchIds,
} from './useContentStudio-fixtures';
import {
  prepareContentStudioHookTest, restoreContentStudioHookTest, settleDeferredJson
} from './useContentStudio-test-fixtures';
import { requestUrlsContaining } from './useContentStudio-request-fixtures';
import {
  activeBatchIds,
  buildTerminalStartBatchStatus,
  generationState,
  renderPendingBatchStart,
  startRunningBatch,
  startTerminalBatch,
} from './useContentStudio-scenario-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import {
  deferAuthenticatedFetch, mockAuthenticatedFetch
} from '../test/infrastructureMock';

beforeEach(prepareContentStudioHookTest);
afterEach(restoreContentStudioHookTest);

describe('useContentStudio accepted batch state', () => {
  it('maps every terminal start child field before any status poll', async () => {
    const {
      fetch, received, result, terminalStart
    } = await startTerminalBatch('terminal-batch');

    expect(received).toStrictEqual(terminalStart);
    expect(result.current.activeBatches).toStrictEqual([
      buildTerminalStartBatchStatus('terminal-batch')
    ]);
    expect(batchStatusRequestUrls(fetch, 'terminal-batch')).toStrictEqual([]);
  });

  it('persists the exact candidate before sending the batch POST', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_234);
    const startRequest = createDeferredResponse();
    const candidatesAtPost: ReturnType<typeof storedActiveContentStudioBatchCandidates>[] = [];
    mockAuthenticatedFetch.mockImplementation(() => {
      candidatesAtPost.push(storedActiveContentStudioBatchCandidates());
      return startRequest.promise;
    });
    const { unmount } = renderPendingBatchStart();

    expect(candidatesAtPost).toStrictEqual([[
      buildBatchCandidate('batch-1', 1_234)
    ]]);
    unmount();
    await settleDeferredJson(startRequest, mockBatchStartResponse);
  });

  it('retains an accepted running batch while polling its status', async () => {
    const {
      result, unmount
    } = await startRunningBatch();

    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-1']);
    expect(result.current.activeBatches[0]?.batch_id).toBe('batch-1');
    unmount();
  });

  it('settles accepted batch state after StrictMode replays effect setup', async () => {
    const batchStatusResponse = buildRunningBatchStatusResponse();
    const fetch = createMockFetch({ batchStatusResponse });
    const { result } = renderContentStudioInStrictMode(fetch);

    const received = await act(() => result.current.generateContentBatch(mockBatchRequest));

    expect(received?.success).toBe(true);
    expect(result.current.activeBatches[0]?.batch_id).toBe('batch-1');
    expect(result.current.generating).toBe(false);
  });

  it('posts one exact batch request without child status requests', async () => {
    const {
      fetch, unmount
    } = await startRunningBatch();

    const batchPosts = fetch.mock.calls.filter(([url, init]) => (
      String(url).endsWith('/generate-batch') && init?.method === 'POST'
    ));
    const childStatusRequests = requestUrlsContaining(fetch, '/status/');
    expect(batchPosts).toHaveLength(1);
    expect(batchPosts[0]?.[1]?.body).toBe(JSON.stringify(mockBatchRequest));
    expect(childStatusRequests).toStrictEqual([]);
    unmount();
  });
});

describe('useContentStudio batch races', () => {
  it('clears an earlier error while a retry remains in flight', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const {
      result, unmount
    } = renderContentStudio(createMockFetch({ shouldFailBatchStart: true }));
    await act(() => result.current.generateContentBatch(mockBatchRequest));
    const deferred = createDeferredResponse();
    mockAuthenticatedFetch.mockReturnValueOnce(deferred.promise);

    act(() => { void result.current.generateContentBatch(mockBatchRequest); });

    expect(generationState(result.current)).toStrictEqual({
      error: null,
      generating: true,
    });
    unmount();
    await settleDeferredJson(deferred, mockBatchStartResponse);
  });

  it('preserves both batches when start responses settle out of order', async () => {
    const {
      firstStart,
      secondStart,
      pendingBatches,
      result,
    } = renderConcurrentBatchStarts();

    secondStart.resolve(createMockJsonResponse(buildTerminalBatchStartResponse('batch-2')));
    await act(() => pendingBatches.second);
    firstStart.resolve(createMockJsonResponse(buildTerminalBatchStartResponse('batch-1')));
    await act(() => pendingBatches.first);

    expect(activeBatchIds(result.current)).toStrictEqual(['batch-1', 'batch-2']);
    expect(result.current.generating).toBe(false);
  });

  it('keeps a newer request generating when an older batch start fails first', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const {
      firstStart,
      secondStart,
      pendingBatches,
      result,
    } = renderConcurrentBatchStarts();

    firstStart.resolve(createMockJsonResponse({ error: 'Older failure' }, 500));
    await act(() => pendingBatches.first);

    expect(generationState(result.current)).toStrictEqual({
      generating: true,
      error: null,
    });
    secondStart.resolve(createMockJsonResponse(buildTerminalBatchStartResponse('batch-2')));
    await act(() => pendingBatches.second);
  });

  it('does not apply a batch start response that settles after unmount', async () => {
    const deferred = deferAuthenticatedFetch();
    const {
      pendingStart, result, unmount
    } = renderPendingBatchStart();

    unmount();
    deferred.resolve(createMockJsonResponse(mockBatchStartResponse));
    const received = await pendingStart;

    expect(received?.batch_id).toBe('batch-1');
    expect(result.current.activeBatches).toStrictEqual([]);
  });

  it('polls when a batch starts with generating children and no pending children', async () => {
    const fetch = createMockFetch({
      batchStartResponse: buildGeneratingBatchStartResponse(),
      batchStatusResponse: buildRunningBatchStatusResponse(),
    });
    const {
      result, unmount
    } = renderContentStudio(fetch);

    await act(() => result.current.generateContentBatch(mockBatchRequest));
    await waitFor(() => {
      expect({
        statusRequests: batchStatusRequestUrls(fetch),
        generating: result.current.activeBatches[0]?.counts.generating,
      }).toStrictEqual({
        statusRequests: ['https://api.test.com/content-studio/batches/batch-1'],
        generating: 2,
      });
    });

    unmount();
  });
});
