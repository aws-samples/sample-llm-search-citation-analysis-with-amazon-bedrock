import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, waitFor
} from '@testing-library/react';
import { createDeferredResponse } from '../test/fetchResponses';
import {
  advanceContentStudioPoll,
  dispatchBatchStorageEvent,
  flushContentStudioPromises,
  newestTrackedBatchIdsAfterElevenStarts,
  queueRunningBatchStarts,
  renderTwoRunningBatches,
  resolveRunningBatchStatus,
  startContentStudioBatches,
} from './useContentStudioBatchTracking-fixtures';
import {
  batchStatusRequestUrls,
  buildMockBatchRequest,
  buildRunningBatchStatusFor,
  buildTerminalBatchStartResponse,
  createMockFetch,
  mockBatchRequest,
  renderContentStudio,
  renderRunningBatchContentStudio,
  storedActiveContentStudioBatchIds,
  storeActiveContentStudioBatchIds,
} from './useContentStudio-fixtures';
import {
  prepareContentStudioHookTest, restoreContentStudioHookTest
} from './useContentStudio-test-fixtures';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

beforeEach(prepareContentStudioHookTest);
afterEach(restoreContentStudioHookTest);

describe('useContentStudioBatchTracking mutation boundaries', () => {
  it('creates no polling interval when no batch IDs are stored', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const fetch = createMockFetch();

    renderContentStudio(fetch);

    const batchRequests = fetch.mock.calls.filter(([url]) => (
      String(url).includes('/batches/')
    ));
    const aggregateIntervals = setIntervalSpy.mock.calls.filter(([, milliseconds]) => (
      milliseconds === 10_000
    ));
    expect(batchRequests).toStrictEqual([]);
    expect(aggregateIntervals).toStrictEqual([]);
  });

  it('replaces one batch card instead of duplicating a repeated batch start', async () => {
    const {
      result, unmount
    } = renderRunningBatchContentStudio();

    await act(() => result.current.generateContentBatch(mockBatchRequest));
    await act(() => result.current.generateContentBatch(mockBatchRequest));

    expect(result.current.activeBatches.map((batch) => batch.batch_id))
      .toStrictEqual(['batch-1']);
    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-1']);
    unmount();
  });

  it('continues polling an accepted running batch after ten seconds', async () => {
    vi.useFakeTimers();
    const {
      fetch, result, unmount
    } = renderRunningBatchContentStudio();
    await act(() => result.current.generateContentBatch(mockBatchRequest));
    await flushContentStudioPromises();

    await advanceContentStudioPoll();

    expect(batchStatusRequestUrls(fetch)).toHaveLength(2);
    unmount();
  });

  it('bounds visible and persisted running batches to the newest ten', async () => {
    const batchIds = Array.from({ length: 11 }, (_, index) => `batch-${index + 1}`);
    queueRunningBatchStarts(batchIds);
    const { result } = renderContentStudio();

    await startContentStudioBatches(result.current, batchIds);

    expect(result.current.activeBatches.map((batch) => batch.batch_id))
      .toStrictEqual(newestTrackedBatchIdsAfterElevenStarts);
    expect(storedActiveContentStudioBatchIds())
      .toStrictEqual(newestTrackedBatchIdsAfterElevenStarts);
  });

  it('keeps an evicted batch absent when an earlier aggregate poll settles later', async () => {
    vi.useFakeTimers();
    queueRunningBatchStarts(['batch-1', 'batch-2']);
    const {
      result, unmount
    } = renderContentStudio();
    await startContentStudioBatches(result.current, ['batch-1', 'batch-2']);
    await flushContentStudioPromises();

    const batchTwoStatus = createDeferredResponse();
    const batchOneStatus = createDeferredResponse();
    mockAuthenticatedFetch
      .mockReturnValueOnce(batchTwoStatus.promise)
      .mockReturnValueOnce(batchOneStatus.promise);
    await advanceContentStudioPoll();
    await resolveRunningBatchStatus(batchOneStatus, 'batch-1');

    const laterBatchIds = Array.from({ length: 9 }, (_, index) => `batch-${index + 3}`);
    queueRunningBatchStarts(laterBatchIds);
    await startContentStudioBatches(result.current, laterBatchIds);
    await resolveRunningBatchStatus(batchTwoStatus, 'batch-2');

    expect(result.current.activeBatches.map((batch) => batch.batch_id))
      .toStrictEqual(newestTrackedBatchIdsAfterElevenStarts);
    expect(storedActiveContentStudioBatchIds())
      .toStrictEqual(newestTrackedBatchIdsAfterElevenStarts);
    unmount();
  });

  it('keeps a storage-removed batch absent when its aggregate poll settles later', async () => {
    storeActiveContentStudioBatchIds(['batch-1', 'batch-2']);
    const batchOneStatus = createDeferredResponse();
    const batchTwoStatus = createDeferredResponse();
    mockAuthenticatedFetch
      .mockReturnValueOnce(batchOneStatus.promise)
      .mockReturnValueOnce(batchTwoStatus.promise);
    const {
      result, unmount
    } = renderContentStudio();
    await resolveRunningBatchStatus(batchOneStatus, 'batch-1');

    dispatchBatchStorageEvent(['batch-2']);
    await resolveRunningBatchStatus(batchTwoStatus, 'batch-2');

    expect(result.current.activeBatches.map((batch) => batch.batch_id))
      .toStrictEqual(['batch-2']);
    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-2']);
    unmount();
  });

  it('removes only the cross-instance batch card that stopped running', async () => {
    const rendered = renderTwoRunningBatches();
    await flushContentStudioPromises();
    expect(rendered.result.current.activeBatches).toHaveLength(2);

    dispatchBatchStorageEvent(['batch-2']);

    expect(rendered.result.current.activeBatches).toStrictEqual([
      buildRunningBatchStatusFor('batch-2')
    ]);
  });

  it('keeps the aggregate interval when a storage event repeats the same IDs', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const {
      result, unmount
    } = renderTwoRunningBatches();
    await waitFor(() => {
      expect(result.current.activeBatches).toHaveLength(2);
    });
    const callsBeforeEvent = clearIntervalSpy.mock.calls.length;

    dispatchBatchStorageEvent(['batch-1', 'batch-2']);

    expect(clearIntervalSpy).toHaveBeenCalledTimes(callsBeforeEvent);
    unmount();
  });

  it('removes a stale stored ID when an accepted start is already terminal', async () => {
    const terminalStart = buildTerminalBatchStartResponse('batch-terminal');
    const fetch = createMockFetch({ batchStartResponse: terminalStart });
    const { result } = renderContentStudio(fetch);
    storeActiveContentStudioBatchIds(['batch-terminal']);

    await act(() => result.current.generateContentBatch(
      buildMockBatchRequest('batch-terminal')
    ));

    expect(storedActiveContentStudioBatchIds()).toStrictEqual([]);
    expect(result.current.activeBatches[0]?.batch_id).toBe('batch-terminal');
  });
});
