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
import { useContentStudio } from './useContentStudio';

export function queueContentStudioPayloads(...payloads: readonly unknown[]): void {
  for (const payload of payloads) {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(payload));
  }
}

export function queueContentStudioResponses(...responses: readonly Response[]): void {
  for (const response of responses) {
    mockAuthenticatedFetch.mockResolvedValueOnce(response);
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
  return mockAuthenticatedFetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes(pathFragment));
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

export async function renderFetchedContentStudio() {
  const rendered = renderHook(() => useContentStudio());
  await act(() => rendered.result.current.fetchHistory());
  return rendered;
}

export async function waitForContentStudioRequests(expectedCount: number): Promise<void> {
  await waitFor(() => {
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(expectedCount);
  });
}

export async function renderPendingItemStatus() {
  const statusRequest = createDeferredResponse();
  mockAuthenticatedFetch
    .mockResolvedValueOnce(createMockJsonResponse(
      buildContentHistoryPayload([mockContentHistory[1]])
    ))
    .mockReturnValueOnce(statusRequest.promise);
  const rendered = await renderFetchedContentStudio();
  await waitForContentStudioRequests(2);
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
