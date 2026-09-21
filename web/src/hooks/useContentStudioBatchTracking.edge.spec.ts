import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY } from '../api/contentStudioBatchStorage';
import { buildBatchCandidate } from '../api/contentStudioBatchStorage-fixtures';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  advanceContentStudioPoll,
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
  mockBatchRequest,
  mockBatchStartResponse,
  renderContentStudio,
  renderRunningBatchContentStudio,
  storeActiveContentStudioBatchCandidates,
  storeActiveContentStudioBatchIds,
  storedActiveContentStudioBatchCandidates,
  storedActiveContentStudioBatchIds,
} from './useContentStudio-fixtures';
import {
  prepareContentStudioHookTest, restoreContentStudioHookTest
} from './useContentStudio-test-fixtures';
import { useContentStudio } from './useContentStudio';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

beforeEach(() => {
  prepareContentStudioHookTest();
});
afterEach(() => {
  restoreContentStudioHookTest();
});

describe('useContentStudioBatchTracking recovery boundaries', () => {
  it('retains a not-found candidate that is one minute old', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    storeActiveContentStudioBatchIds(['young-batch'], 940_000);
    const fetch = createMockFetch({ missingBatchIds: ['young-batch'] });

    renderContentStudio(fetch);
    await flushContentStudioPromises();
    await flushContentStudioPromises();

    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['young-batch']);
    expect(batchStatusRequestUrls(fetch, 'young-batch')).toHaveLength(1);
  });

  it('removes a not-found candidate at the exact five-minute boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    storeActiveContentStudioBatchIds(
      ['expired-batch'],
      1_000_000 - CONTENT_STUDIO_BATCH_NOT_FOUND_GRACE_MS
    );
    const fetch = createMockFetch({
      historyResponse: buildContentHistoryPayload([]),
      missingBatchIds: ['expired-batch'],
    });

    renderContentStudio(fetch);
    await flushContentStudioPromises();
    await flushContentStudioPromises();

    expect(storedActiveContentStudioBatchIds()).toStrictEqual([]);
    expect(batchStatusRequestUrls(fetch, 'expired-batch')).toHaveLength(1);
  });

  it('retains an expired candidate when status fails with a server response', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    storeActiveContentStudioBatchIds(
      ['ambiguous-batch'],
      1_000_000 - CONTENT_STUDIO_BATCH_NOT_FOUND_GRACE_MS
    );
    const fetch = createMockFetch({ shouldFailBatchStatus: true });

    renderContentStudio(fetch);
    await flushContentStudioPromises();
    await flushContentStudioPromises();

    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['ambiguous-batch']);
    expect(batchStatusRequestUrls(fetch, 'ambiguous-batch')).toHaveLength(1);
  });

  it('polls only the candidate whose timestamp changed in another tab', async () => {
    storeActiveContentStudioBatchCandidates([
      buildBatchCandidate('batch-1', 900),
      buildBatchCandidate('batch-2', 800),
    ]);
    const fetch = createMockFetch({
      batchStatusResponses: {
        'batch-1': buildRunningBatchStatusFor('batch-1'),
        'batch-2': buildRunningBatchStatusFor('batch-2'),
      },
    });
    renderContentStudio(fetch);
    await flushContentStudioPromises();

    dispatchBatchCandidateStorageEvent([
      buildBatchCandidate('batch-1', 900),
      buildBatchCandidate('batch-2', 850),
    ]);
    await flushContentStudioPromises();

    expect(batchStatusRequestUrls(fetch, 'batch-1')).toHaveLength(1);
    expect(batchStatusRequestUrls(fetch, 'batch-2')).toHaveLength(2);
  });

  it('recovers legacy IDs when another tab writes the v1 key', async () => {
    const batchStatusResponses = Object.fromEntries([[
      'legacy-batch', buildRunningBatchStatusFor('legacy-batch')
    ]]);
    const fetch = createMockFetch({ batchStatusResponses });
    const { result } = renderContentStudio(fetch);

    act(() => {
      localStorage.setItem(
        LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY,
        JSON.stringify(['legacy-batch'])
      );
      globalThis.dispatchEvent(new StorageEvent(
        'storage',
        { key: LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY }
      ));
    });
    await waitFor(() => {
      expect(result.current.activeBatches.map((batch) => batch.batch_id))
        .toStrictEqual(['legacy-batch']);
    });

    expect(batchStatusRequestUrls(fetch, 'legacy-batch')).toHaveLength(1);
  });

  it('replaces acknowledged pending counts with the found running status', async () => {
    const {
      result, unmount
    } = renderRunningBatchContentStudio();

    await act(() => result.current.generateContentBatch(mockBatchRequest));
    await waitFor(() => {
      expect(result.current.activeBatches[0]?.counts).toStrictEqual({
        pending: 0,
        generating: 2,
        generated: 0,
        failed: 0,
        missing: 0,
        total: 2,
      });
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

    const visibleBatchIds = result.current.activeBatches.map((batch) => batch.batch_id);
    expect(visibleBatchIds).toStrictEqual(newestTrackedBatchIdsAfterElevenStarts);
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

    expect(result.current.activeBatches.map((batch) => batch.batch_id)).toStrictEqual([
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
    const staleStatus = createDeferredResponse();
    const currentStatus = createDeferredResponse();
    mockAuthenticatedFetch
      .mockReturnValueOnce(staleStatus.promise)
      .mockReturnValueOnce(currentStatus.promise);
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
    const startRequest = createDeferredResponse();
    const currentStatus = createDeferredResponse();
    mockAuthenticatedFetch
      .mockReturnValueOnce(startRequest.promise)
      .mockReturnValueOnce(currentStatus.promise);
    const {
      result, unmount
    } = renderHook(() => useContentStudio());
    const pendingStarts = new Set<ReturnType<typeof result.current.generateContentBatch>>();
    act(() => {
      pendingStarts.add(result.current.generateContentBatch(mockBatchRequest));
    });
    vi.setSystemTime(200);

    dispatchBatchCandidateStorageEvent([
      buildBatchCandidate('batch-1', 200)
    ]);
    startRequest.resolve(createMockJsonResponse(mockBatchStartResponse));
    await act(() => Promise.all(pendingStarts));

    expect(result.current.activeBatches).toStrictEqual([]);
    expect(storedActiveContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('batch-1', 200)
    ]);
    unmount();
    currentStatus.resolve(createMockJsonResponse(buildRunningBatchStatusResponse()));
    await currentStatus.promise;
  });
});
