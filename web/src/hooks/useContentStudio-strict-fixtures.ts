import {
  useEffect, useRef
} from 'react';
import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import type { authenticatedFetch } from '../infrastructure/auth';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  buildContentHistoryPayload,
  contentStudioStrictModeBoundary,
  mockBatchRequest,
  mockContentIdea,
} from './useContentStudio-fixtures';
import { useContentStudio } from './useContentStudio';

type ContentStudioHookResult = ReturnType<typeof useContentStudio>;

function useHistoryLoadOnMount() {
  const contentStudio = useContentStudio();
  const fetchOnMount = useRef(contentStudio.fetchHistory).current;
  useEffect(() => {
    void fetchOnMount();
  }, [fetchOnMount]);
  return contentStudio;
}

function useGenerationStartOnMount() {
  const contentStudio = useContentStudio();
  const generateOnMount = useRef(contentStudio.generateContent).current;
  useEffect(() => {
    void generateOnMount(mockContentIdea);
  }, [generateOnMount]);
  return contentStudio;
}

function useBatchStartOnMount() {
  const contentStudio = useContentStudio();
  const generateOnMount = useRef(contentStudio.generateContentBatch).current;
  useEffect(() => {
    void generateOnMount(mockBatchRequest);
  }, [generateOnMount]);
  return contentStudio;
}

function renderReplayedRequests(
  useScenario: () => ContentStudioHookResult,
  fallbackPayload?: unknown
) {
  const firstRequest = createDeferredResponse();
  const secondRequest = createDeferredResponse();
  const fetch = vi.fn<typeof authenticatedFetch>();
  if (fallbackPayload !== undefined) {
    fetch.mockImplementation(() => Promise.resolve(
      createMockJsonResponse(fallbackPayload)
    ));
  }
  fetch
    .mockReturnValueOnce(firstRequest.promise)
    .mockReturnValueOnce(secondRequest.promise);
  mockAuthenticatedFetch.mockImplementation(fetch);
  const rendered = renderHook(useScenario, {wrapper: contentStudioStrictModeBoundary,});
  return {
    firstRequest,
    secondRequest,
    fetch,
    rendered,
  };
}

export function renderReplayedHistoryLoad() {
  return renderReplayedRequests(useHistoryLoadOnMount);
}

export function renderReplayedGenerationStart() {
  return renderReplayedRequests(useGenerationStartOnMount);
}

export function renderReplayedBatchStart() {
  const firstRequest = createDeferredResponse();
  const secondRequest = createDeferredResponse();
  const recoveryRequest = createDeferredResponse();
  const batchStarts = { count: 0 };
  const fetch = vi.fn<typeof authenticatedFetch>().mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes('/batches/')) return recoveryRequest.promise;
    if (url.includes('/generate-batch') && init?.method === 'POST') {
      batchStarts.count += 1;
      return batchStarts.count === 1 ? firstRequest.promise : secondRequest.promise;
    }
    return Promise.resolve(createMockJsonResponse(buildContentHistoryPayload([])));
  });
  mockAuthenticatedFetch.mockImplementation(fetch);
  const rendered = renderHook(
    useBatchStartOnMount,
    {wrapper: contentStudioStrictModeBoundary,}
  );
  return {
    firstRequest,
    secondRequest,
    recoveryRequest,
    fetch,
    rendered,
  };
}
