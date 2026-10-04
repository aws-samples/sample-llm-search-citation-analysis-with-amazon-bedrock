import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  expect, vi
} from 'vitest';
import { createMockJsonResponse } from '../test/fetchResponses';
import { deferAuthenticatedFetch } from '../test/infrastructureMock';
import type {
  ContentBriefBatchStartResponse,
  ContentBriefBatchStatusResponse,
  ContentStudioHistory,
  GenerateContentResponse,
} from '../types';
import {
  batchStatusRequestUrls,
  buildContentHistoryPayload,
  buildMockBatchRequest,
  buildTerminalBatchStartResponse,
  createMockFetch,
  mockBatchRequest,
  mockBatchStatusResponse,
  mockContentHistory,
  renderContentStudio,
  renderRunningBatchContentStudio,
} from './useContentStudio-fixtures';
import {
  flushContentStudioPromises, renderTwoRunningBatches
} from './useContentStudioBatchTracking-fixtures';
import { queueTwoDeferredContentStudioRequests } from './useContentStudio-test-fixtures';
import { startTwoOverlappingCalls } from './useContentStudio-request-fixtures';
import { useContentStudio } from './useContentStudio';

type ContentStudioState = ReturnType<typeof useContentStudio>;

export function activeBatchIds(
  contentStudio: Pick<ContentStudioState, 'activeBatches'>
): string[] {
  return contentStudio.activeBatches.map((batch) => batch.batch_id);
}

export function generationState(
  contentStudio: Pick<ContentStudioState, 'error' | 'generating'>
) {
  return {
    error: contentStudio.error,
    generating: contentStudio.generating,
  };
}

export function buildStartedGenerationResponse(id: string): GenerateContentResponse {
  return {
    success: true,
    id,
    status: 'pending',
    keyword: 'best hotels',
  };
}

/** The card a terminal batch start maps to: the start children carry no timestamps or errors. */
export function buildTerminalStartBatchStatus(batchId: string): ContentBriefBatchStatusResponse {
  return {
    ...mockBatchStatusResponse,
    batch_id: batchId,
    children: mockBatchStatusResponse.children.map((child) => ({
      ...child,
      created_at: null,
      updated_at: null,
      error_message: null,
    })),
  };
}

/** `renderRunningBatchContentStudio` after `mockBatchRequest` has been accepted. */
export async function startRunningBatch() {
  const rendered = renderRunningBatchContentStudio();
  await act(() => rendered.result.current.generateContentBatch(mockBatchRequest));
  return rendered;
}

/** Renders a hook whose batch POST answers already-terminal, then starts `batchId`. */
export async function startTerminalBatch(batchId: string) {
  const terminalStart = buildTerminalBatchStartResponse(batchId);
  const fetch = createMockFetch({ batchStartResponse: terminalStart });
  const rendered = renderContentStudio(fetch);
  const received = await act(() => rendered.result.current.generateContentBatch(
    buildMockBatchRequest(batchId)
  ));
  return {
    ...rendered,
    fetch,
    received,
    terminalStart,
  };
}

/** `renderTwoRunningBatches` under fake timers, after the recovery polls settle. */
export async function renderTwoRunningBatchesWithFakeTimers() {
  vi.useFakeTimers();
  const rendered = renderTwoRunningBatches();
  await flushContentStudioPromises();
  return rendered;
}

/** `renderTwoRunningBatches` once both recovered cards are visible. */
export async function renderTwoVisibleRunningBatches() {
  const rendered = renderTwoRunningBatches();
  await waitFor(() => {
    expect(rendered.result.current.activeBatches).toHaveLength(2);
  });
  return rendered;
}

/** Status-request count per batch ID, for asserting several recovered batches at once. */
export function batchStatusRequestCounts(
  fetch: ReturnType<typeof createMockFetch>,
  batchIds: readonly string[]
): Record<string, number> {
  return Object.fromEntries(batchIds.map((batchId) => [
    batchId, batchStatusRequestUrls(fetch, batchId).length
  ]));
}

/** Spies on `setInterval`; the returned reader lists the ten-second aggregate poll intervals. */
export function spyOnAggregatePollIntervals(): () => unknown[] {
  const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
  return () => setIntervalSpy.mock.calls.filter(([, milliseconds]) => milliseconds === 10_000);
}

/** Renders a bare hook and starts `mockBatchRequest` without awaiting it. */
export function renderPendingBatchStart() {
  const rendered = renderHook(() => useContentStudio());
  const pending: { start: Promise<ContentBriefBatchStartResponse | null> } = {start: Promise.resolve(null),};
  act(() => {
    pending.start = rendered.result.current.generateContentBatch(mockBatchRequest);
  });
  return {
    ...rendered,
    pendingStart: pending.start,
  };
}

/**
 * Starts two overlapping history loads and settles the newer one with the
 * first history row; the older request is left for the spec to settle.
 */
export function startOverlappingHistoryLoads() {
  const {
    newerRequest, olderRequest
  } = queueTwoDeferredContentStudioRequests();
  const rendered = renderHook(() => useContentStudio());
  const loads = startTwoOverlappingCalls<ContentStudioHistory[]>(
    () => rendered.result.current.fetchHistory(),
    []
  );
  newerRequest.resolve(createMockJsonResponse(buildContentHistoryPayload([
    mockContentHistory[0]
  ])));
  return {
    ...rendered,
    loads,
    olderRequest,
  };
}

/** Renders the default mocked hook and runs one action on it inside `act`. */
export async function runContentStudioAction<TResult>(
  run: (contentStudio: ContentStudioState) => Promise<TResult>,
  fetch: ReturnType<typeof createMockFetch> = createMockFetch()
) {
  const rendered = renderContentStudio(fetch);
  const received = await act(() => run(rendered.result.current));
  return {
    ...rendered,
    received,
  };
}

/** Renders a bare hook whose next request stays pending, then fires `start` without awaiting it. */
export function renderInFlightContentStudioAction(
  start: (contentStudio: ContentStudioState) => Promise<unknown>
) {
  const deferred = deferAuthenticatedFetch();
  const rendered = renderHook(() => useContentStudio());
  act(() => { void start(rendered.result.current); });
  return {
    ...rendered,
    deferred,
  };
}
