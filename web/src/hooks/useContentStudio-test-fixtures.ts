import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  expect, vi
} from 'vitest';
import {
  createDeferredResponse, createMockJsonResponse, type DeferredResponse
} from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import type {
  ContentStatus, ContentStudioHistory
} from '../types';
import {
  buildContentHistoryPayload, mockContentHistory
} from './useContentStudio-fixtures';
import { requestUrlsContaining } from './useContentStudio-request-fixtures';
import { useContentStudio } from './useContentStudio';

/**
 * Queues one reply per upcoming `authenticatedFetch` call, in order: a pending
 * promise (e.g. a deferred request) is returned as is, a `Response` is resolved
 * as is, and anything else is resolved as a JSON payload.
 */
export function queueContentStudioPayloads(...payloads: readonly unknown[]): void {
  for (const payload of payloads) {
    if (payload instanceof Promise) {
      mockAuthenticatedFetch.mockReturnValueOnce(payload);
    } else {
      mockAuthenticatedFetch.mockResolvedValueOnce(
        payload instanceof Response ? payload : createMockJsonResponse(payload)
      );
    }
  }
}

export function queueTwoDeferredContentStudioRequests() {
  const olderRequest = createDeferredResponse();
  const newerRequest = createDeferredResponse();
  mockAuthenticatedFetch
    .mockReturnValueOnce(olderRequest.promise)
    .mockReturnValueOnce(newerRequest.promise);
  return {
    newerRequest,
    olderRequest,
  };
}

export function contentStudioRequestUrls(pathFragment: string): string[] {
  return requestUrlsContaining(mockAuthenticatedFetch, pathFragment);
}

export function contentStatusPayload(id: string, status: ContentStatus) {
  return {
    id,
    status,
  };
}

export function historyItemWithStatus(
  item: ContentStudioHistory,
  status: ContentStatus
): ContentStudioHistory {
  return {
    ...item,
    status,
  };
}

async function renderFetchedContentStudio() {
  const rendered = renderHook(() => useContentStudio());
  await act(() => rendered.result.current.fetchHistory());
  return rendered;
}

export async function waitForContentStudioRequests(expectedCount: number): Promise<void> {
  await waitFor(() => {
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(expectedCount);
  });
}

/** Queues `payloads`, renders, loads history, then waits for `expectedRequests` fetches. */
export async function renderQueuedContentStudio(
  expectedRequests: number,
  ...payloads: readonly unknown[]
) {
  queueContentStudioPayloads(...payloads);
  const rendered = await renderFetchedContentStudio();
  await waitForContentStudioRequests(expectedRequests);
  return rendered;
}

export const generatingHistoryPayload = buildContentHistoryPayload([mockContentHistory[1]]);

export async function renderPendingItemStatus() {
  const statusRequest = createDeferredResponse();
  const rendered = await renderQueuedContentStudio(
    2,
    generatingHistoryPayload,
    statusRequest.promise
  );
  return {
    statusRequest,
    rendered,
  };
}

export async function settleDeferredJson(
  deferred: DeferredResponse,
  payload: unknown
): Promise<void> {
  deferred.resolve(createMockJsonResponse(payload));
  await deferred.promise;
}

export function prepareContentStudioHookTest(): void {
  vi.clearAllMocks();
  localStorage.clear();
}

export function restoreContentStudioHookTest(): void {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
}
