import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import { buildBatchCandidate } from '../api/contentStudioBatchStorage-fixtures';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import {
  advanceContentStudioPoll,
  buildTerminalBatchStatusFor,
  dispatchBatchCandidateStorageEvent,
  flushContentStudioPromises,
  renderRecoveredBatches,
} from './useContentStudioBatchTracking-fixtures';
import {
  buildContentHistoryPayload,
  buildRunningBatchStatusResponse,
  buildTerminalBatchStartResponse,
  mockBatchRequest,
  storeActiveContentStudioBatchCandidates,
  storedActiveContentStudioBatchIds,
} from './useContentStudio-fixtures';
import { batchStatusRequestCounts } from './useContentStudio-scenario-fixtures';
import {
  contentStudioRequestUrls,
  prepareContentStudioHookTest,
  queueContentStudioPayloads,
  restoreContentStudioHookTest,
  settleDeferredJson,
} from './useContentStudio-test-fixtures';
import { useContentStudio } from './useContentStudio';

beforeEach(prepareContentStudioHookTest);
afterEach(restoreContentStudioHookTest);

describe('useContentStudioBatchTracking finalization ownership', () => {
  it('runs one history refresh when duplicate terminal acknowledgements share a candidate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const terminalStart = buildTerminalBatchStartResponse('batch-1');
    const historyRequest = createDeferredResponse();
    queueContentStudioPayloads(terminalStart, historyRequest.promise, terminalStart);
    const { result } = renderHook(() => useContentStudio());

    await act(() => result.current.generateContentBatch(mockBatchRequest));
    await act(() => result.current.generateContentBatch(mockBatchRequest));

    expect(contentStudioRequestUrls('/history')).toHaveLength(1);
    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-1']);
    historyRequest.resolve(createMockJsonResponse(buildContentHistoryPayload([])));
    await flushContentStudioPromises();
  });

  it('polls a candidate again when the same identity is registered after cleanup', async () => {
    const candidate = buildBatchCandidate('batch-1', 100);
    storeActiveContentStudioBatchCandidates([candidate]);
    queueContentStudioPayloads(
      buildTerminalBatchStatusFor('batch-1'),
      buildContentHistoryPayload([]),
      buildRunningBatchStatusResponse()
    );
    const { result } = renderHook(() => useContentStudio());
    await waitFor(() => {
      expect(storedActiveContentStudioBatchIds()).toStrictEqual([]);
    });

    dispatchBatchCandidateStorageEvent([candidate]);
    await waitFor(() => {
      expect(result.current.activeBatches).toStrictEqual([
        buildRunningBatchStatusResponse()
      ]);
    });

    expect(contentStudioRequestUrls('/batches/batch-1')).toHaveLength(2);
  });

  it('keeps newer finalization locked when stale history settles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const initialCandidate = buildBatchCandidate('batch-1', 100);
    const replacementCandidate = buildBatchCandidate('batch-1', 200);
    storeActiveContentStudioBatchCandidates([initialCandidate]);
    const staleHistory = createDeferredResponse();
    const currentHistory = createDeferredResponse();
    queueContentStudioPayloads(
      buildTerminalBatchStatusFor('batch-1'),
      staleHistory.promise,
      buildTerminalBatchStatusFor('batch-1'),
      currentHistory.promise
    );
    const rendered = renderHook(() => useContentStudio());
    await flushContentStudioPromises();
    await flushContentStudioPromises();

    dispatchBatchCandidateStorageEvent([replacementCandidate]);
    await flushContentStudioPromises();
    staleHistory.resolve(createMockJsonResponse(buildContentHistoryPayload([])));
    await flushContentStudioPromises();
    await advanceContentStudioPoll();

    expect(contentStudioRequestUrls('/batches/batch-1')).toHaveLength(2);
    rendered.unmount();
    await settleDeferredJson(currentHistory, buildContentHistoryPayload([]));
  });

  it('keeps the aggregate interval stable when stale cleanup changes no candidate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const staleHistory = createDeferredResponse();
    storeActiveContentStudioBatchCandidates([
      buildBatchCandidate('batch-1', 100)
    ]);
    queueContentStudioPayloads(
      buildTerminalBatchStatusFor('batch-1'),
      staleHistory.promise,
      buildRunningBatchStatusResponse()
    );
    const rendered = renderHook(() => useContentStudio());
    await flushContentStudioPromises();

    dispatchBatchCandidateStorageEvent([
      buildBatchCandidate('batch-1', 200)
    ]);
    await flushContentStudioPromises();
    const cleanupCallsBeforeStaleHistory = clearIntervalSpy.mock.calls.length;
    staleHistory.resolve(createMockJsonResponse(buildContentHistoryPayload([])));
    await flushContentStudioPromises();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(cleanupCallsBeforeStaleHistory);
    rendered.unmount();
  });

  it('stops polling after two candidates finalize together', async () => {
    vi.useFakeTimers();
    const { fetch } = renderRecoveredBatches({
      'terminal-1': buildTerminalBatchStatusFor('terminal-1'),
      'terminal-2': buildTerminalBatchStatusFor('terminal-2'),
    }, { historyResponse: buildContentHistoryPayload([]) });
    await flushContentStudioPromises();
    await flushContentStudioPromises();

    await advanceContentStudioPoll();

    expect(batchStatusRequestCounts(fetch, ['terminal-1', 'terminal-2'])).toStrictEqual({
      'terminal-1': 1,
      'terminal-2': 1,
    });
  });
});
