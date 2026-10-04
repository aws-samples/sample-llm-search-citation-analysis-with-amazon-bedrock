import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  buildBatchCandidate, storeBatchCandidateValue, storedBatchCandidateValue
} from '../api/contentStudioBatchStorage-fixtures';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import {
  advanceContentStudioPoll,
  buildRunningBatchStatusesFor,
  buildTerminalBatchStatusFor,
  dispatchBatchCandidateStorageEvent,
  dispatchBatchStorageEvent,
  flushContentStudioPromises,
  renderRecoveredBatches,
  renderTwoRunningBatches,
} from './useContentStudioBatchTracking-fixtures';
import {
  contentStudioRequestUrls,
  prepareContentStudioHookTest,
  queueContentStudioPayloads,
  restoreContentStudioHookTest,
  settleDeferredJson,
  waitForContentStudioRequests,
} from './useContentStudio-test-fixtures';
import { requestUrlsContaining } from './useContentStudio-request-fixtures';
import {
  activeBatchIds,
  batchStatusRequestCounts,
  renderTwoRunningBatchesWithFakeTimers,
  spyOnAggregatePollIntervals,
  renderTwoVisibleRunningBatches,
  startTerminalBatch,
} from './useContentStudio-scenario-fixtures';
import { CONTENT_STUDIO_BATCH_NOT_FOUND_GRACE_MS } from './useContentStudioBatchTracking';
import {
  batchStatusRequestUrls,
  buildContentHistoryPayload,
  buildMockBatchRequest,
  buildRunningBatchStatusFor,
  buildRunningBatchStatusResponse,
  buildTerminalBatchStartResponse,
  contentStudioStrictModeBoundary,
  createMockFetch,
  mockBatchStatusResponse,
  renderContentStudio,
  storeActiveContentStudioBatchCandidates,
  storeActiveContentStudioBatchIds,
  storedActiveContentStudioBatchCandidates,
  storedActiveContentStudioBatchIds,
} from './useContentStudio-fixtures';
import { useContentStudio } from './useContentStudio';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import {
  deferNextTwoAuthenticatedFetches, mockAuthenticatedFetch
} from '../test/infrastructureMock';

beforeEach(prepareContentStudioHookTest);
afterEach(restoreContentStudioHookTest);

describe('useContentStudio recovered batch persistence', () => {
  it('recovers and requests every stored nonterminal batch', async () => {
    const {
      fetch, result
    } = renderTwoRunningBatches();

    await waitFor(() => {
      expect(activeBatchIds(result.current)).toStrictEqual(['batch-1', 'batch-2']);
    });

    expect(batchStatusRequestCounts(fetch, ['batch-1', 'batch-2'])).toStrictEqual({
      'batch-1': 1,
      'batch-2': 1,
    });
  });

  it('uses one ten-second interval for every recovered batch', async () => {
    const aggregatePollIntervals = spyOnAggregatePollIntervals();
    const {
      fetch, unmount
    } = renderTwoRunningBatches();
    await waitFor(() => {
      expect(batchStatusRequestUrls(fetch, 'batch-2')).toHaveLength(1);
    });

    expect(aggregatePollIntervals()).toHaveLength(1);
    unmount();
  });

  it('ignores malformed persisted candidate state without making requests', () => {
    storeBatchCandidateValue('{broken');
    const fetch = createMockFetch();

    renderContentStudio(fetch);

    expect(requestUrlsContaining(fetch, '/batches/')).toStrictEqual([]);
    expect(storedBatchCandidateValue()).toBeNull();
  });

  it('retains a young not-found candidate for a later recovery poll', async () => {
    storeActiveContentStudioBatchIds(['candidate-batch']);
    const fetch = createMockFetch({ missingBatchIds: ['candidate-batch'] });
    const { result } = renderContentStudio(fetch);

    await waitFor(() => {
      expect(batchStatusRequestUrls(fetch, 'candidate-batch')).toHaveLength(1);
    });
    await flushContentStudioPromises();

    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['candidate-batch']);
    expect(result.current.activeBatches).toStrictEqual([]);
    expect(requestUrlsContaining(fetch, '/history')).toStrictEqual([]);
  });

  it('removes a not-found candidate when its five-minute grace has elapsed', async () => {
    storeActiveContentStudioBatchIds([
      'expired-batch'
    ], Date.now() - CONTENT_STUDIO_BATCH_NOT_FOUND_GRACE_MS);
    const fetch = createMockFetch({ missingBatchIds: ['expired-batch'] });
    const { result } = renderContentStudio(fetch);

    await waitFor(() => {
      expect(storedActiveContentStudioBatchIds()).toStrictEqual([]);
    });

    expect(result.current.activeBatches).toStrictEqual([]);
    expect(requestUrlsContaining(fetch, '/history')).toContain(
      'https://api.test.com/content-studio/history?limit=20'
    );
  });

  it('removes a terminal candidate only after history refresh settles', async () => {
    storeActiveContentStudioBatchIds(['batch-1']);
    const historyRequest = createDeferredResponse();
    queueContentStudioPayloads(mockBatchStatusResponse, historyRequest.promise);
    const { result } = renderHook(() => useContentStudio());
    await waitForContentStudioRequests(2);

    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-1']);
    expect(result.current.activeBatches).toStrictEqual([mockBatchStatusResponse]);
    historyRequest.resolve(createMockJsonResponse(buildContentHistoryPayload([])));
    await waitFor(() => {
      expect(storedActiveContentStudioBatchIds()).toStrictEqual([]);
    });
  });

  it('polls only the running batch after mixed recovered outcomes', async () => {
    vi.useFakeTimers();
    const { fetch } = renderRecoveredBatches({
      'batch-terminal': buildTerminalBatchStatusFor('batch-terminal'),
      'batch-running': buildRunningBatchStatusFor('batch-running'),
    });
    await flushContentStudioPromises();

    await advanceContentStudioPoll();

    expect(batchStatusRequestCounts(fetch, ['batch-terminal', 'batch-running'])).toStrictEqual({
      'batch-terminal': 1,
      'batch-running': 2,
    });
    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-running']);
  });
});

describe('useContentStudio aggregate batch timer', () => {
  it('requests another status for every tracked batch after ten seconds', async () => {
    const {
      fetch, unmount
    } = await renderTwoRunningBatchesWithFakeTimers();

    await advanceContentStudioPoll();

    expect(batchStatusRequestCounts(fetch, ['batch-1', 'batch-2'])).toStrictEqual({
      'batch-1': 2,
      'batch-2': 2,
    });
    unmount();
  });

  it('does not overlap aggregate requests that are still pending', async () => {
    vi.useFakeTimers();
    storeActiveContentStudioBatchIds(['batch-1', 'batch-2']);
    const [firstStatus, secondStatus] = deferNextTwoAuthenticatedFetches();
    const rendered = renderHook(() => useContentStudio());

    await advanceContentStudioPoll();

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
    rendered.unmount();
    firstStatus.resolve(new Response());
    secondStatus.resolve(new Response());
    await Promise.all([firstStatus.promise, secondStatus.promise]);
  });

  it('keeps initial progress when a status request fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const fetch = createMockFetch({ shouldFailBatchStatus: true });
    const { result } = renderContentStudio(fetch);

    await act(() => result.current.generateContentBatch(
      buildMockBatchRequest('batch-1')
    ));
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        '[content] Error polling Content Brief batch:',
        expect.objectContaining({ statusCode: 500 })
      );
    });

    expect(result.current.activeBatches[0]?.counts.pending).toBe(2);
  });

  it('clears the aggregate interval after the final batch becomes terminal', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    storeActiveContentStudioBatchIds(['batch-1']);
    const fetch = createMockFetch({
      historyResponse: buildContentHistoryPayload([]),
      batchStatusResponse: mockBatchStatusResponse,
    });
    renderContentStudio(fetch);
    await waitFor(() => {
      expect(storedActiveContentStudioBatchIds()).toStrictEqual([]);
    });

    expect(clearIntervalSpy).toHaveBeenCalledWith(expect.anything());
  });

  it('clears the aggregate interval when the hook unmounts', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const {
      fetch, unmount
    } = renderTwoRunningBatches();
    await waitFor(() => {
      expect(batchStatusRequestUrls(fetch, 'batch-1')).toHaveLength(1);
    });
    const callsBeforeUnmount = clearIntervalSpy.mock.calls.length;

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(callsBeforeUnmount + 1);
  });
});

describe('useContentStudio cross-instance batch synchronization', () => {
  it('stops polling a removed ID while retaining the other running card', async () => {
    const {
      fetch, result, unmount
    } = await renderTwoRunningBatchesWithFakeTimers();

    dispatchBatchStorageEvent(['batch-2']);
    await advanceContentStudioPoll();

    expect(activeBatchIds(result.current)).toStrictEqual(['batch-2']);
    expect(batchStatusRequestCounts(fetch, ['batch-1', 'batch-2'])).toStrictEqual({
      'batch-1': 1,
      'batch-2': 2,
    });
    unmount();
  });

  it('clears running cards when another instance clears storage', async () => {
    const { result } = await renderTwoVisibleRunningBatches();

    dispatchBatchStorageEvent([], null);

    expect(result.current.activeBatches).toStrictEqual([]);
  });

  it('recovers a batch added by another instance with one request', async () => {
    const batchStatusResponses = buildRunningBatchStatusesFor(['batch-added']);
    const fetch = createMockFetch({ batchStatusResponses });
    const { result } = renderContentStudio(fetch);

    dispatchBatchStorageEvent(['batch-added']);
    await waitFor(() => {
      expect(result.current.activeBatches).toHaveLength(1);
    });

    expect(batchStatusRequestUrls(fetch, 'batch-added')).toHaveLength(1);
  });

  it('does not request unchanged candidates again after a repeated storage event', async () => {
    const { fetch } = await renderTwoVisibleRunningBatches();

    dispatchBatchStorageEvent(['batch-1', 'batch-2']);

    expect(batchStatusRequestCounts(fetch, ['batch-1', 'batch-2'])).toStrictEqual({
      'batch-1': 1,
      'batch-2': 1,
    });
  });

  it('invalidates a stale poll when another tab replaces the candidate timestamp', async () => {
    const initialCandidate = buildBatchCandidate('batch-1', Date.now() - 100);
    const replacementCandidate = buildBatchCandidate('batch-1', Date.now());
    storeActiveContentStudioBatchCandidates([initialCandidate]);
    const [staleStatus, currentStatus] = deferNextTwoAuthenticatedFetches();
    const {
      result, unmount
    } = renderHook(() => useContentStudio());
    await waitForContentStudioRequests(1);

    dispatchBatchCandidateStorageEvent([replacementCandidate]);
    staleStatus.resolve(createMockJsonResponse(mockBatchStatusResponse));
    await flushContentStudioPromises();
    currentStatus.resolve(createMockJsonResponse(buildRunningBatchStatusResponse()));
    await waitFor(() => {
      expect(result.current.activeBatches).toStrictEqual([
        buildRunningBatchStatusResponse()
      ]);
    });

    expect(storedActiveContentStudioBatchCandidates()).toStrictEqual([
      replacementCandidate
    ]);
    expect(contentStudioRequestUrls('/history')).toStrictEqual([]);
    unmount();
  });

  it('ignores storage events for a different key', async () => {
    const {
      fetch, result, unmount
    } = await renderTwoRunningBatchesWithFakeTimers();

    dispatchBatchStorageEvent([], 'other.key');
    await advanceContentStudioPoll();

    expect(result.current.activeBatches).toHaveLength(2);
    expect(batchStatusRequestUrls(fetch, 'batch-1')).toHaveLength(2);
    unmount();
  });

  it('removes its storage listener when the hook unmounts', () => {
    const removeListenerSpy = vi.spyOn(globalThis, 'removeEventListener');
    const { unmount } = renderContentStudio();

    unmount();

    expect(removeListenerSpy).toHaveBeenCalledWith('storage', expect.any(Function));
  });
});

describe('useContentStudio batch request races', () => {
  it('keeps a replayed running poll when the discarded poll settles first', async () => {
    storeActiveContentStudioBatchIds(['batch-1']);
    const [firstStatus, secondStatus] = deferNextTwoAuthenticatedFetches();
    const {
      result, unmount
    } = renderHook(
      () => useContentStudio(),
      {wrapper: contentStudioStrictModeBoundary,}
    );

    firstStatus.resolve(createMockJsonResponse(mockBatchStatusResponse));
    await act(() => firstStatus.promise);
    secondStatus.resolve(createMockJsonResponse(buildRunningBatchStatusResponse()));
    await act(() => secondStatus.promise);

    expect(result.current.activeBatches).toStrictEqual([buildRunningBatchStatusResponse()]);
    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-1']);
    unmount();
  });

  it('does not log a rejected poll cancelled by storage synchronization', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    storeActiveContentStudioBatchIds(['batch-1']);
    const statusRequest = createDeferredResponse();
    queueContentStudioPayloads(statusRequest.promise);
    renderHook(() => useContentStudio());

    dispatchBatchStorageEvent([]);
    statusRequest.reject(new TypeError('Network connection lost'));
    await act(() => statusRequest.promise.catch(vi.fn()));

    expect(consoleError).toHaveBeenCalledTimes(0);
  });

  it('retains in-memory running candidates when storage cleanup is unavailable', async () => {
    vi.useFakeTimers();
    const batchStatusResponses = buildRunningBatchStatusesFor(['batch-terminal', 'batch-running']);
    const { fetch } = renderRecoveredBatches(batchStatusResponses);
    await flushContentStudioPromises();
    batchStatusResponses['batch-terminal'] = buildTerminalBatchStatusFor('batch-terminal');
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new TypeError('Storage unavailable');
    });

    await advanceContentStudioPoll();
    await advanceContentStudioPoll();

    expect(batchStatusRequestCounts(fetch, ['batch-terminal', 'batch-running'])).toStrictEqual({
      'batch-terminal': 2,
      'batch-running': 3,
    });
    getItemSpy.mockRestore();
  });

  it('preserves a terminal card when another batch expires as not found', async () => {
    vi.useFakeTimers();
    const missingBatchIds: string[] = [];
    storeActiveContentStudioBatchIds(['batch-1']);
    const terminalStart = buildTerminalBatchStartResponse('batch-terminal');
    const fetch = createMockFetch({
      historyResponse: buildContentHistoryPayload([]),
      batchStartResponse: terminalStart,
      batchStatusResponse: buildRunningBatchStatusResponse(),
      missingBatchIds,
    });
    const { result } = renderContentStudio(fetch);
    await flushContentStudioPromises();
    await act(() => result.current.generateContentBatch(
      buildMockBatchRequest('batch-terminal')
    ));
    missingBatchIds.push('batch-1');
    vi.setSystemTime(Date.now() + CONTENT_STUDIO_BATCH_NOT_FOUND_GRACE_MS);

    await advanceContentStudioPoll();

    expect(activeBatchIds(result.current)).toStrictEqual(['batch-terminal']);
  });

  it('does not replace terminal outcomes while an added status is pending', async () => {
    const {
      result, unmount
    } = await startTerminalBatch('batch-terminal');
    const terminalOutcomes = result.current.activeBatches;
    const addedStatus = createDeferredResponse();
    queueContentStudioPayloads(addedStatus.promise);

    dispatchBatchStorageEvent(['batch-added']);

    expect(result.current.activeBatches).toBe(terminalOutcomes);
    unmount();
    await settleDeferredJson(addedStatus, buildRunningBatchStatusFor('batch-added'));
  });
});
