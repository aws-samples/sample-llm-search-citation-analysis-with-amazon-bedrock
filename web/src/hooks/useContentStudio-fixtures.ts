import { vi } from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import type { authenticatedFetch } from '../infrastructure/auth';
import type {
  ContentIdea, ContentStatus, ContentStudioHistory
} from '../types';
import {
  createDeferredResponse,
  createMockJsonResponse,
  type DeferredResponse,
} from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { useContentStudio } from './useContentStudio';

export type StatusFailure = 'http' | 'network' | 'invalid';

interface StatusResponse {
  readonly id: string;
  readonly status: ContentStatus;
}

interface MockFetchOptions {
  ideasResponse?: { ideas: ContentIdea[] };
  historyResponse?: {
    history: ContentStudioHistory[];
    total_count: number;
    unviewed_count: number;
  };
  generateResponse?: {
    success: boolean;
    id: string;
    status: string;
    keyword: string;
    error?: string;
  };
  statusResponse?: StatusResponse;
  statusResponses?: Readonly<Record<string, StatusResponse>>;
  statusFailure?: StatusFailure;
  statusFailures?: Readonly<Record<string, StatusFailure>>;
  historyRefreshFailureDelayMs?: number;
  shouldFail?: boolean;
  shouldFailGenerate?: boolean;
}

export interface DeferredStatusRequest {
  readonly contentId: string;
  readonly signal: AbortSignal | null;
  readonly response: DeferredResponse;
}

export function setupContentStudioConsoleErrorMock() {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
}

export function renderContentStudio(
  fetch: ReturnType<typeof createMockFetch> = createMockFetch()
) {
  mockAuthenticatedFetch.mockImplementation(fetch);
  return renderHook(() => useContentStudio());
}

export const mockContentIdea: ContentIdea = {
  id: 'idea-1',
  type: 'visibility_gap',
  priority: 'high',
  title: 'Top Hotels Guide',
  description: 'Focus on unique amenities',
  keyword: 'best hotels',
  source: 'https://example.com/article',
  competitor_brands: ['Marriott'],
  actionable: true,
};

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

export const mockContentHistory: ContentStudioHistory[] = [
  {
    id: 'content-1',
    keyword: 'best hotels',
    idea_title: 'Top Hotels Guide',
    content_angle: 'comprehensive_guide',
    generated_content: {
      title: 'Best Hotels Guide',
      meta_description: 'Comprehensive guide to the best hotels',
      body: 'Generated article content',
      suggested_headings: ['Introduction', 'Top Hotels'],
      key_points: ['Unique amenities', 'Location benefits']
    },
    competitor_sources_used: 3,
    status: 'generated',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    viewed: false,
  },
  buildPollingHistoryItem('content-2'),
];

function requestedContentId(url: string): string {
  return decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
}

function contentGenerationResponse(options: MockFetchOptions): Promise<Response> {
  if (options.shouldFailGenerate) {
    return Promise.resolve(createMockJsonResponse({ error: 'Generation failed' }, 500));
  }
  return Promise.resolve(createMockJsonResponse(options.generateResponse ?? {
    success: true,
    id: 'new-content-1',
    status: 'pending',
    keyword: 'test'
  }));
}

function contentStatusResponse(
  url: string,
  options: MockFetchOptions
): Promise<Response> {
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
  return Promise.resolve(createMockJsonResponse(
    options.statusResponses?.[contentId]
      ?? options.statusResponse
      ?? {
        id: contentId,
        status: 'generated'
      }
  ));
}

function contentHistoryResponse(
  options: MockFetchOptions,
  requestCount: { value: number }
): Promise<Response> {
  const isRefresh = requestCount.value > 0;
  requestCount.value += 1;
  if (isRefresh && options.historyRefreshFailureDelayMs !== undefined) {
    return new Promise<Response>((resolve) => {
      setTimeout(() => {
        resolve(createMockJsonResponse({}, 500));
      }, options.historyRefreshFailureDelayMs);
    });
  }
  return Promise.resolve(createMockJsonResponse(options.historyResponse ?? {
    history: mockContentHistory,
    total_count: 2,
    unviewed_count: 1
  }));
}

export function createMockFetch(options: MockFetchOptions = {}) {
  if (options.shouldFail) {
    return vi.fn<typeof authenticatedFetch>().mockResolvedValue(
      createMockJsonResponse({}, 500)
    );
  }
  const historyRequestCount = { value: 0 };
  return vi.fn<typeof authenticatedFetch>().mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes('/ideas')) {
      return Promise.resolve(createMockJsonResponse(options.ideasResponse ?? {
        ideas: [mockContentIdea],
        total_count: 1,
        generated_at: '2024-01-01'
      }));
    }
    if (url.includes('/history')) {
      return contentHistoryResponse(options, historyRequestCount);
    }
    if (url.includes('/generate') && init?.method === 'POST') {
      return contentGenerationResponse(options);
    }
    if (url.includes('/status/')) return contentStatusResponse(url, options);
    if (url.includes('/viewed')) {
      return Promise.resolve(createMockJsonResponse({ success: true }));
    }
    if (init?.method === 'DELETE') {
      return Promise.resolve(createMockJsonResponse({ success: true }));
    }
    return Promise.resolve(createMockJsonResponse({}));
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
      return Promise.resolve(createMockJsonResponse({
        history: selectedHistory,
        total_count: selectedHistory.length,
        unviewed_count: selectedHistory.filter((item) => !item.viewed).length,
      }));
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
  const renderedHook = renderContentStudio(createMockFetch({
    statusFailure,
    historyResponse: {
      history: generatingHistory,
      total_count: 1,
      unviewed_count: 0,
    },
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
