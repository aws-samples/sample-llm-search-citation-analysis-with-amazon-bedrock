import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { authenticatedFetch } from '../infrastructure/auth';
import type {
  ContentStatus, ContentStudioHistory
} from '../types';
import {
  createDeferredResponse,
  createMockJsonResponse,
  type DeferredResponse,
} from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  buildContentHistoryPayload,
  createMockFetch,
  mockContentHistory,
  renderContentStudio,
} from './useContentStudio-fixtures';

export type StatusFailure = 'http' | 'network' | 'invalid';

interface PollingMockFetchOptions {
  historyResponse?: unknown;
  statusResponses?: Readonly<Record<string, unknown>>;
  statusFailure?: StatusFailure;
  statusFailures?: Readonly<Record<string, StatusFailure>>;
  historyRefreshFailureDelayMs?: number;
}

export interface DeferredStatusRequest {
  readonly contentId: string;
  readonly signal: AbortSignal | null;
  readonly response: DeferredResponse;
}

export function setupContentStudioConsoleErrorMock() {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
}

export function buildPollingHistoryItem(
  id: string,
  status: ContentStatus = 'generating'
): ContentStudioHistory {
  return {
    id,
    keyword: `keyword-${id}`,
    idea_title: `Idea ${id}`,
    content_angle: 'comprehensive_guide',
    generated_content: {
      title: `Title ${id}`,
      meta_description: `Description ${id}`,
      body: `Body ${id}`,
      suggested_headings: ['Overview'],
      key_points: ['First point'],
    },
    competitor_sources_used: 0,
    status,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    viewed: true,
  };
}

function requestedContentId(url: string): string {
  return decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
}

function contentStatusResponse(
  url: string,
  options: PollingMockFetchOptions
): Promise<Response> | undefined {
  const contentId = requestedContentId(url);
  const statusFailure = options.statusFailures?.[contentId] ?? options.statusFailure;
  if (statusFailure === 'network') {
    return Promise.reject(new TypeError('Network unavailable'));
  }
  if (statusFailure === 'http') {
    return Promise.resolve(createMockJsonResponse({}, 503));
  }
  if (statusFailure === 'invalid') {
    return Promise.resolve(createMockJsonResponse({ status: 'unknown' }));
  }
  const statusResponse = options.statusResponses?.[contentId];
  return statusResponse === undefined
    ? undefined
    : Promise.resolve(createMockJsonResponse(statusResponse));
}

function contentHistoryRefreshFailure(
  options: PollingMockFetchOptions,
  requestCount: { value: number }
): Promise<Response> | undefined {
  const isRefresh = requestCount.value > 0;
  requestCount.value += 1;
  if (!isRefresh || options.historyRefreshFailureDelayMs === undefined) return undefined;
  return new Promise<Response>((resolve) => {
    setTimeout(() => {
      resolve(createMockJsonResponse({}, 500));
    }, options.historyRefreshFailureDelayMs);
  });
}

/** `createMockFetch` plus the per-item status failures and delayed history refresh failure the polling specs need. */
export function createPollingMockFetch(options: PollingMockFetchOptions = {}) {
  const baseFetch = createMockFetch({ historyResponse: options.historyResponse });
  const historyRequestCount = { value: 0 };
  return vi.fn<typeof authenticatedFetch>().mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes('/status/')) {
      return contentStatusResponse(url, options) ?? baseFetch(input, init);
    }
    if (url.includes('/history')) {
      return contentHistoryRefreshFailure(options, historyRequestCount) ?? baseFetch(input, init);
    }
    return baseFetch(input, init);
  });
}

export function createDeferredStatusFetch(
  historyResponses: readonly (readonly ContentStudioHistory[])[]
) {
  const statusRequests: DeferredStatusRequest[] = [];
  const historyResponseIndex = { value: 0 };
  const fallbackHistory = historyResponses[historyResponses.length - 1] ?? [];
  const fetch = vi.fn<typeof authenticatedFetch>().mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes('/history')) {
      const selectedHistory = historyResponses[historyResponseIndex.value] ?? fallbackHistory;
      historyResponseIndex.value += 1;
      return Promise.resolve(createMockJsonResponse(buildContentHistoryPayload(selectedHistory)));
    }
    if (url.includes('/status/')) {
      const response = createDeferredResponse();
      statusRequests.push({
        contentId: requestedContentId(url),
        signal: init?.signal ?? null,
        response,
      });
      return response.promise;
    }
    return Promise.resolve(createMockJsonResponse({}));
  });
  return {
    fetch,
    statusRequests
  };
}

export async function settleDeferredStatusBatch(
  statusRequests: readonly DeferredStatusRequest[],
  outcomes: readonly (ContentStatus | 'network-failure')[]
): Promise<void> {
  await act(async () => {
    outcomes.forEach((outcome, index) => {
      const statusRequest = statusRequests[index];
      if (outcome === 'network-failure') {
        statusRequest.response.reject(new TypeError('Item unavailable'));
        return;
      }
      statusRequest.response.resolve(createMockJsonResponse({
        id: statusRequest.contentId,
        status: outcome,
      }));
    });
    await vi.advanceTimersByTimeAsync(0);
  });
}

export async function renderContentStudioWithDeferredPolling(
  historyResponses: readonly (readonly ContentStudioHistory[])[]
) {
  vi.useFakeTimers();
  const deferredStatusFetch = createDeferredStatusFetch(historyResponses);
  const renderedHook = renderContentStudio(deferredStatusFetch.fetch);
  await act(async () => {
    await renderedHook.result.current.fetchHistory();
  });
  return {
    ...renderedHook,
    deferredStatusFetch
  };
}

export async function unmountContentStudioWithActiveStatusRequest() {
  const renderedHook = await renderContentStudioWithDeferredPolling([[
    buildPollingHistoryItem('content-a'),
  ]]);
  const activeRequest = renderedHook.deferredStatusFetch.statusRequests[0];
  renderedHook.unmount();
  return {
    activeRequest,
    deferredStatusFetch: renderedHook.deferredStatusFetch
  };
}

export async function renderContentStudioAfterStatusFailureLimit(
  statusFailure: StatusFailure
) {
  vi.useFakeTimers();
  const generatingHistory = mockContentHistory.slice(1);
  const renderedHook = renderContentStudio(createPollingMockFetch({
    statusFailure,
    historyResponse: buildContentHistoryPayload(generatingHistory),
  }));

  await act(async () => {
    await renderedHook.result.current.fetchHistory();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  return renderedHook;
}

export function countContentStatusRequests(contentId?: string): number {
  return mockAuthenticatedFetch.mock.calls.filter(([input]) => {
    const url = String(input);
    return url.includes('/status/')
      && (contentId === undefined || requestedContentId(url) === contentId);
  }).length;
}

export function countContentHistoryRequests(): number {
  return mockAuthenticatedFetch.mock.calls.filter(
    ([input]) => String(input).includes('/history')
  ).length;
}
