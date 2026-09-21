import {
  StrictMode, createElement, useEffect, type ReactNode
} from 'react';
import {
  act, renderHook
} from '@testing-library/react';
import { vi } from 'vitest';
import {
  apiBatchStartResponse, apiBatchStatusResponse
} from '../api/contentStudio-fixtures';
import {
  ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
  CONTENT_STUDIO_BATCH_STORAGE_VERSION,
  readStoredContentStudioBatchCandidates,
  type ContentStudioBatchCandidate,
} from '../api/contentStudioBatchStorage';
import type { authenticatedFetch } from '../infrastructure/auth';
import type {
  ContentBriefBatchRequest,
  ContentBriefBatchStartResponse,
  ContentBriefBatchStatusResponse,
  ContentIdea,
  ContentStatus,
  ContentStudioHistory,
} from '../types';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { useContentStudio } from './useContentStudio';

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
      key_points: ['Unique amenities', 'Location benefits'],
    },
    competitor_sources_used: 3,
    status: 'generated',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    viewed: false,
  },
  {
    id: 'content-2',
    keyword: 'luxury resorts',
    idea_title: 'Luxury Resorts Review',
    content_angle: 'differentiation',
    competitor_sources_used: 0,
    status: 'generating',
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    viewed: true,
  },
];

export const mockBatchStartResponse: ContentBriefBatchStartResponse = {
  ...apiBatchStartResponse,
  batch_id: 'batch-1',
  accepted_count: 2,
  existing_count: 0,
  failed_count: 0,
  children: apiBatchStartResponse.children.map((child) => ({
    ...child,
    status: 'pending',
  })),
};

export const mockBatchStatusResponse: ContentBriefBatchStatusResponse = {
  ...apiBatchStatusResponse,
  batch_id: 'batch-1',
};

export const mockBatchRequest = {
  batch_id: 'batch-1',
  scope: {
    mode: 'keywords',
    keyword_ids: ['keyword-1', 'keyword-2'],
  },
  brief: {
    content_angle: 'create_new_landing_page',
    landing_url: '',
    current_copy: '',
    template_id: 'builtin-create-new-landing-page',
    prompt_template: 'Create a brief for {scope}.',
    output_language: 'English',
  },
} satisfies ContentBriefBatchRequest;

interface MockFetchOptions {
  ideasResponse?: unknown;
  historyResponse?: unknown;
  generateResponse?: unknown;
  batchStartResponse?: unknown;
  batchStatusResponse?: unknown;
  batchStatusResponses?: Readonly<Record<string, unknown>>;
  missingBatchIds?: readonly string[];
  statusResponse?: unknown;
  shouldFail?: boolean;
  shouldFailGenerate?: boolean;
  shouldFailBatchStart?: boolean;
  shouldFailBatchStatus?: boolean;
}

function payloadOrDefault(payload: unknown, fallback: unknown): unknown {
  return payload === undefined ? fallback : payload;
}

export function buildContentHistoryPayload(
  history: readonly ContentStudioHistory[] = mockContentHistory
): unknown {
  return {
    history: history.map((item) => ({
      ...item,
      generated_content: item.generated_content ?? {},
    })),
    total_count: history.length,
    unviewed_count: history.filter((item) => !item.viewed).length,
  };
}

function requestedBatchId(url: string): string {
  return decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
}

function batchStatusResponse(url: string, options: MockFetchOptions): Response {
  const batchId = requestedBatchId(url);
  if (options.missingBatchIds?.includes(batchId) === true) {
    return createMockJsonResponse({ error: 'Batch not found' }, 404, 'Not Found');
  }
  if (options.shouldFailBatchStatus === true) {
    return createMockJsonResponse({ error: 'Batch status failed' }, 500);
  }
  const mapped = options.batchStatusResponses?.[batchId];
  const fallback = options.batchStatusResponse ?? {
    ...mockBatchStatusResponse,
    batch_id: batchId,
  };
  return createMockJsonResponse(payloadOrDefault(mapped, fallback));
}

function readResponse(url: string, options: MockFetchOptions): Response | undefined {
  if (url.includes('/ideas')) {
    return createMockJsonResponse(payloadOrDefault(options.ideasResponse, {
      ideas: [mockContentIdea],
      total_count: 1,
      generated_at: '2024-01-01',
    }));
  }
  if (url.includes('/history')) {
    return createMockJsonResponse(payloadOrDefault(
      options.historyResponse,
      buildContentHistoryPayload()
    ));
  }
  if (url.includes('/batches/')) return batchStatusResponse(url, options);
  if (url.includes('/status/')) {
    return createMockJsonResponse(payloadOrDefault(options.statusResponse, {
      id: 'content-2',
      status: 'generating',
    }));
  }
  return undefined;
}

function writeResponse(
  url: string,
  method: string,
  options: MockFetchOptions
): Response {
  if (url.includes('/generate-batch') && method === 'POST') {
    if (options.shouldFailBatchStart === true) {
      return createMockJsonResponse({ error: 'Batch start failed' }, 500);
    }
    return createMockJsonResponse(payloadOrDefault(
      options.batchStartResponse,
      mockBatchStartResponse
    ), 202);
  }
  if (url.endsWith('/generate') && method === 'POST') {
    if (options.shouldFailGenerate === true) {
      return createMockJsonResponse({ error: 'Generation failed' }, 500);
    }
    return createMockJsonResponse(payloadOrDefault(options.generateResponse, {
      success: true,
      id: 'new-content-1',
      status: 'pending',
      keyword: 'test',
    }));
  }
  if (url.includes('/viewed')) {
    return createMockJsonResponse({
      success: true,
      id: 'content-1',
    });
  }
  if (method === 'DELETE') {
    return createMockJsonResponse({
      success: true,
      message: 'Content deleted successfully',
    });
  }
  return createMockJsonResponse({});
}

export function createMockFetch(options: MockFetchOptions = {}) {
  return vi.fn<typeof authenticatedFetch>().mockImplementation((input, init) => {
    if (options.shouldFail === true) {
      return Promise.resolve(createMockJsonResponse({}, 500));
    }
    const url = String(input);
    const response = readResponse(url, options);
    if (response !== undefined) return Promise.resolve(response);
    return Promise.resolve(writeResponse(url, init?.method ?? 'GET', options));
  });
}

interface StrictModeBoundaryProps { readonly children: ReactNode; }

export function contentStudioStrictModeBoundary({ children }: StrictModeBoundaryProps) {
  return createElement(StrictMode, null, children);
}

export function renderContentStudio(
  fetch: ReturnType<typeof createMockFetch> = createMockFetch()
) {
  mockAuthenticatedFetch.mockImplementation(fetch);
  return renderHook(() => useContentStudio());
}

export function renderContentStudioInStrictMode(
  fetch: ReturnType<typeof createMockFetch> = createMockFetch()
) {
  mockAuthenticatedFetch.mockImplementation(fetch);
  return renderHook(
    () => useContentStudio(),
    {wrapper: contentStudioStrictModeBoundary,}
  );
}

function useContentStudioWithInitialHistory() {
  const contentStudio = useContentStudio();
  useEffect(() => {
    void contentStudio.fetchHistory();
  }, [contentStudio.fetchHistory]);
  return contentStudio;
}

export function renderInitialHistoryInStrictMode(
  fetch: ReturnType<typeof createMockFetch> = createMockFetch()
) {
  mockAuthenticatedFetch.mockImplementation(fetch);
  return renderHook(
    () => useContentStudioWithInitialHistory(),
    {wrapper: contentStudioStrictModeBoundary,}
  );
}

export function storeActiveContentStudioBatchCandidates(
  candidates: readonly ContentStudioBatchCandidate[]
): void {
  localStorage.setItem(
    ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
    JSON.stringify({
      version: CONTENT_STUDIO_BATCH_STORAGE_VERSION,
      entries: candidates,
    })
  );
}

export function storeActiveContentStudioBatchIds(
  batchIds: readonly string[],
  registeredAt = Date.now()
): void {
  storeActiveContentStudioBatchCandidates(batchIds.map((batchId) => ({
    id: batchId,
    registeredAt,
  })));
}

export function storedActiveContentStudioBatchCandidates(): ContentStudioBatchCandidate[] {
  return readStoredContentStudioBatchCandidates();
}

export function storedActiveContentStudioBatchIds(): string[] {
  return storedActiveContentStudioBatchCandidates().map((candidate) => candidate.id);
}

export function buildTerminalBatchStartResponse(
  batchId: string
): ContentBriefBatchStartResponse {
  return {
    ...mockBatchStartResponse,
    batch_id: batchId,
    accepted_count: 0,
    existing_count: 2,
    failed_count: 0,
    children: [
      {
        ...mockBatchStartResponse.children[0],
        status: 'generated',
        idempotent_hit: true,
      },
      {
        ...mockBatchStartResponse.children[1],
        status: 'failed',
        idempotent_hit: true,
      },
    ],
  };
}

export function buildGeneratingBatchStartResponse(
  batchId = 'batch-1'
): ContentBriefBatchStartResponse {
  return {
    ...mockBatchStartResponse,
    batch_id: batchId,
    children: mockBatchStartResponse.children.map((child) => ({
      ...child,
      status: 'generating' satisfies ContentStatus,
    })),
  };
}

export function buildRunningBatchStatusResponse(
  overrides: Partial<ContentBriefBatchStatusResponse> = {}
): ContentBriefBatchStatusResponse {
  return {
    ...mockBatchStatusResponse,
    children: mockBatchStatusResponse.children.map((child) => ({
      ...child,
      status: 'generating' satisfies ContentStatus,
      has_content: false,
      error_message: null,
    })),
    counts: {
      pending: 0,
      generating: 2,
      generated: 0,
      failed: 0,
      missing: 0,
      total: 2,
    },
    ...overrides,
  };
}

export function buildRunningBatchStatusFor(
  batchId: string
): ContentBriefBatchStatusResponse {
  return buildRunningBatchStatusResponse({ batch_id: batchId });
}

export function renderRunningBatchContentStudio() {
  const batchStatusResponse = buildRunningBatchStatusResponse();
  const fetch = createMockFetch({ batchStatusResponse });
  return {
    ...renderContentStudio(fetch),
    fetch,
  };
}

export function batchStatusRequestUrls(
  fetch: ReturnType<typeof createMockFetch>,
  batchId = 'batch-1'
): string[] {
  return fetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes(`/batches/${batchId}`));
}

export function renderConcurrentBatchStarts() {
  const firstStart = createDeferredResponse();
  const secondStart = createDeferredResponse();
  mockAuthenticatedFetch
    .mockImplementation(() => Promise.resolve(
      createMockJsonResponse(buildContentHistoryPayload([]))
    ))
    .mockReturnValueOnce(firstStart.promise)
    .mockReturnValueOnce(secondStart.promise);
  const rendered = renderHook(() => useContentStudio());
  const pendingBatches: {
    first: Promise<ContentBriefBatchStartResponse | null>;
    second: Promise<ContentBriefBatchStartResponse | null>;
  } = {
    first: Promise.resolve(null),
    second: Promise.resolve(null),
  };
  act(() => {
    pendingBatches.first = rendered.result.current.generateContentBatch(
      buildMockBatchRequest('batch-1')
    );
    pendingBatches.second = rendered.result.current.generateContentBatch(
      buildMockBatchRequest('batch-2')
    );
  });
  return {
    ...rendered,
    firstStart,
    secondStart,
    pendingBatches,
  };
}

export function buildMockBatchRequest(batchId: string): ContentBriefBatchRequest {
  return {
    ...mockBatchRequest,
    batch_id: batchId,
  };
}
