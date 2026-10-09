import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY } from '../api/contentStudioBatchStorage';
import { dispatchStorageEvent } from '../test/storageMock';
import {
  buildBatchCandidate, storeLegacyBatchIdsValue
} from '../api/contentStudioBatchStorage-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import {
  deferNextTwoAuthenticatedFetches, mockAuthenticatedFetch
} from '../test/infrastructureMock';
import {
  advanceContentStudioPoll,
  buildRunningBatchStatusesFor,
  dispatchBatchCandidateStorageEvent,
  flushContentStudioPromises,
  newestTrackedBatchIdsAfterElevenStarts,
  queueTerminalBatchStarts,
  startContentStudioBatches,
} from './useContentStudioBatchTracking-fixtures';
import { CONTENT_STUDIO_BATCH_NOT_FOUND_GRACE_MS } from './useContentStudioBatchTracking';
import {
  batchStatusRequestUrls,
  buildContentHistoryPayload,
  buildRunningBatchStatusFor,
  buildRunningBatchStatusResponse,
  createMockFetch,
  mockBatchStartResponse,
  renderContentStudio,
  storeActiveContentStudioBatchCandidates,
  storeActiveContentStudioBatchIds,
  storedActiveContentStudioBatchCandidates,
  storedActiveContentStudioBatchIds,
} from './useContentStudio-fixtures';
import {
  prepareContentStudioHookTest, restoreContentStudioHookTest
} from './useContentStudio-test-fixtures';
import {
  activeBatchIds,
  batchStatusRequestCounts,
  renderPendingBatchStart,
  startRunningBatch,
} from './useContentStudio-scenario-fixtures';
import { useContentStudio } from './useContentStudio';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const expiredRegistration = 1_000_000 - CONTENT_STUDIO_BATCH_NOT_FOUND_GRACE_MS;

const notFoundRecoveryCases = [
  {
    name: 'retains a not-found candidate that is one minute old',
    batchId: 'young-batch',
    registeredAt: 940_000,
    fetchOptions: { missingBatchIds: ['young-batch'] },
    expectedStoredIds: ['young-batch'],
  },
  {
    name: 'removes a not-found candidate at the exact five-minute boundary',
    batchId: 'expired-batch',
    registeredAt: expiredRegistration,
    fetchOptions: {
      historyResponse: buildContentHistoryPayload([]),
      missingBatchIds: ['expired-batch'],
    },
    expectedStoredIds: [],
  },
  {
    name: 'retains an expired candidate when status fails with a server response',
    batchId: 'ambiguous-batch',
    registeredAt: expiredRegistration,
    fetchOptions: { shouldFailBatchStatus: true },
    expectedStoredIds: ['ambiguous-batch'],
  },
];

beforeEach(prepareContentStudioHookTest);
afterEach(restoreContentStudioHookTest);

describe('useContentStudioBatchTracking recovery boundaries', () => {
  it.each(notFoundRecoveryCases)('$name', async ({
    batchId, registeredAt, fetchOptions, expectedStoredIds
  }) => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    storeActiveContentStudioBatchIds([batchId], registeredAt);
    const fetch = createMockFetch(fetchOptions);

    renderContentStudio(fetch);
    await flushContentStudioPromises();
    await flushContentStudioPromises();

    expect(storedActiveContentStudioBatchIds()).toStrictEqual(expectedStoredIds);
    expect(batchStatusRequestUrls(fetch, batchId)).toHaveLength(1);
  });

  it('polls only the candidate whose timestamp changed in another tab', async () => {
    storeActiveContentStudioBatchCandidates([
      buildBatchCandidate('batch-1', 900),
      buildBatchCandidate('batch-2', 800),
    ]);
    const batchStatusResponses = buildRunningBatchStatusesFor(['batch-1', 'batch-2']);
    const fetch = createMockFetch({ batchStatusResponses });
    renderContentStudio(fetch);
    await flushContentStudioPromises();

    dispatchBatchCandidateStorageEvent([
      buildBatchCandidate('batch-1', 900),
      buildBatchCandidate('batch-2', 850),
    ]);
    await flushContentStudioPromises();

    expect(batchStatusRequestCounts(fetch, ['batch-1', 'batch-2'])).toStrictEqual({
      'batch-1': 1,
      'batch-2': 2,
    });
  });

  it('recovers legacy IDs when another tab writes the v1 key', async () => {
    const batchStatusResponses = buildRunningBatchStatusesFor(['legacy-batch']);
    const fetch = createMockFetch({ batchStatusResponses });
    const { result } = renderContentStudio(fetch);

    act(() => {
      storeLegacyBatchIdsValue(JSON.stringify(['legacy-batch']));
      dispatchStorageEvent(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY);
    });
    await waitFor(() => {
      expect(activeBatchIds(result.current)).toStrictEqual(['legacy-batch']);
    });

    expect(batchStatusRequestUrls(fetch, 'legacy-batch')).toHaveLength(1);
  });

  it('replaces acknowledged pending counts with the found running status', async () => {
    const {
      result, unmount
    } = await startRunningBatch();
    await waitFor(() => {
      expect(result.current.activeBatches[0]?.counts)
        .toStrictEqual(buildRunningBatchStatusResponse().counts);
    });

    unmount();
  });
});

describe('useContentStudioBatchTracking active batch bounds', () => {
  it('keeps only the newest ten acknowledged batch cards', async () => {
    const batchIds = [
      'batch-1', 'batch-2', 'batch-3', 'batch-4', 'batch-5', 'batch-6',
      'batch-7', 'batch-8', 'batch-9', 'batch-10', 'batch-11',
    ];
    const { result } = renderContentStudio();
    queueTerminalBatchStarts(batchIds);

    await startContentStudioBatches(result.current, batchIds);

    expect(activeBatchIds(result.current)).toStrictEqual(newestTrackedBatchIdsAfterElevenStarts);
  });

  it('keeps only ten cards when recovered status joins terminal outcomes', async () => {
    const terminalBatchIds = Array.from({ length: 10 }, (_, index) => (
      `terminal-${index + 1}`
    ));
    queueTerminalBatchStarts(terminalBatchIds);
    const { result } = renderContentStudio();
    await startContentStudioBatches(result.current, terminalBatchIds);
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(
      buildRunningBatchStatusFor('recovered-batch')
    ));

    dispatchBatchCandidateStorageEvent([
      buildBatchCandidate('recovered-batch', Date.now())
    ]);
    await waitFor(() => {
      expect(result.current.activeBatches[0]?.batch_id).toBe('recovered-batch');
    });

    expect(activeBatchIds(result.current)).toStrictEqual([
      'recovered-batch',
      'terminal-10',
      'terminal-9',
      'terminal-8',
      'terminal-7',
      'terminal-6',
      'terminal-5',
      'terminal-4',
      'terminal-3',
      'terminal-2',
    ]);
  });
});

describe('useContentStudioBatchTracking stale response ownership', () => {
  it('keeps the replacement poll locked when a stale request settles', async () => {
    vi.useFakeTimers();
    storeActiveContentStudioBatchCandidates([
      buildBatchCandidate('batch-1', 100)
    ]);
    const [staleStatus, currentStatus] = deferNextTwoAuthenticatedFetches();
    const rendered = renderHook(() => useContentStudio());
    await flushContentStudioPromises();

    dispatchBatchCandidateStorageEvent([
      buildBatchCandidate('batch-1', 200)
    ]);
    staleStatus.resolve(createMockJsonResponse(buildRunningBatchStatusResponse()));
    await flushContentStudioPromises();
    await advanceContentStudioPoll();

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
    rendered.unmount();
    currentStatus.resolve(createMockJsonResponse(buildRunningBatchStatusResponse()));
    await currentStatus.promise;
  });

  it('ignores an accepted start for a candidate replaced while POST was pending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const [startRequest, currentStatus] = deferNextTwoAuthenticatedFetches();
    const {
      pendingStart, result, unmount
    } = renderPendingBatchStart();
    vi.setSystemTime(200);

    dispatchBatchCandidateStorageEvent([
      buildBatchCandidate('batch-1', 200)
    ]);
    startRequest.resolve(createMockJsonResponse(mockBatchStartResponse));
    await act(() => pendingStart);

    expect(result.current.activeBatches).toStrictEqual([]);
    expect(storedActiveContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('batch-1', 200)
    ]);
    unmount();
    currentStatus.resolve(createMockJsonResponse(buildRunningBatchStatusResponse()));
    await currentStatus.promise;
  });
});
