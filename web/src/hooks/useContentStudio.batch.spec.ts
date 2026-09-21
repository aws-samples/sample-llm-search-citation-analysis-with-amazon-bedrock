import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { buildBatchCandidate } from '../api/contentStudioBatchStorage-fixtures';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import { useContentStudio } from './useContentStudio';
import {
  batchStatusRequestUrls,
  buildGeneratingBatchStartResponse,
  buildMockBatchRequest,
  buildRunningBatchStatusResponse,
  buildTerminalBatchStartResponse,
  createMockFetch,
  mockBatchRequest,
  mockBatchStartResponse,
  renderConcurrentBatchStarts,
  renderContentStudio,
  renderContentStudioInStrictMode,
  renderRunningBatchContentStudio,
  storedActiveContentStudioBatchCandidates,
  storedActiveContentStudioBatchIds,
} from './useContentStudio-fixtures';
import {
  prepareContentStudioHookTest, restoreContentStudioHookTest
} from './useContentStudio-test-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import {
  deferAuthenticatedFetch, mockAuthenticatedFetch
} from '../test/infrastructureMock';
import type { ContentBriefBatchStartResponse } from '../types';

beforeEach(prepareContentStudioHookTest);
afterEach(restoreContentStudioHookTest);

describe('useContentStudio accepted batch state', () => {
  it('maps every terminal start child field before any status poll', async () => {
    const terminalStart = buildTerminalBatchStartResponse('terminal-batch');
    const fetch = createMockFetch({ batchStartResponse: terminalStart });
    const { result } = renderContentStudio(fetch);

    const received = await act(() => result.current.generateContentBatch(
      buildMockBatchRequest('terminal-batch')
    ));

    expect(received).toStrictEqual(terminalStart);
    expect(result.current.activeBatches).toStrictEqual([{
      batch_id: 'terminal-batch',
      batch_size: 2,
      counts: {
        pending: 0,
        generating: 0,
        generated: 1,
        failed: 1,
        missing: 0,
        total: 2,
      },
      children: [
        {
          id: 'content-1',
          idea_id: 'idea-1',
          keyword_id: 'keyword-1',
          keyword: 'Alpha keyword',
          status: 'generated',
          batch_position: 1,
          created_at: null,
          updated_at: null,
          has_content: true,
          error_message: null,
        },
        {
          id: 'content-2',
          idea_id: 'idea-2',
          keyword_id: 'keyword-2',
          keyword: 'Beta keyword',
          status: 'failed',
          batch_position: 2,
          created_at: null,
          updated_at: null,
          has_content: false,
          error_message: null,
        },
      ],
    }]);
    expect(batchStatusRequestUrls(fetch, 'terminal-batch')).toStrictEqual([]);
  });

  it('persists the exact candidate before sending the batch POST', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_234);
    const startRequest = createDeferredResponse();
    const candidatesAtPost: ReturnType<typeof storedActiveContentStudioBatchCandidates>[] = [];
    mockAuthenticatedFetch.mockImplementation(() => {
      candidatesAtPost.push(storedActiveContentStudioBatchCandidates());
      return startRequest.promise;
    });
    const {
      result, unmount
    } = renderHook(() => useContentStudio());

    act(() => { void result.current.generateContentBatch(mockBatchRequest); });

    expect(candidatesAtPost).toStrictEqual([[
      buildBatchCandidate('batch-1', 1_234)
    ]]);
    unmount();
    startRequest.resolve(createMockJsonResponse(mockBatchStartResponse));
    await startRequest.promise;
  });

  it('retains an accepted running batch while polling its status', async () => {
    const {
      result, unmount
    } = renderRunningBatchContentStudio();

    await act(() => result.current.generateContentBatch(mockBatchRequest));

    expect(storedActiveContentStudioBatchIds()).toStrictEqual(['batch-1']);
    expect(result.current.activeBatches[0]?.batch_id).toBe('batch-1');
    unmount();
  });

  it('settles accepted batch state after StrictMode replays effect setup', async () => {
    const batchStatusResponse = buildRunningBatchStatusResponse();
    const fetch = createMockFetch({ batchStatusResponse });
    const { result } = renderContentStudioInStrictMode(fetch);

    const received = await act(() => result.current.generateContentBatch(mockBatchRequest));

    expect(received?.success).toBe(true);
    expect(result.current.activeBatches[0]?.batch_id).toBe('batch-1');
    expect(result.current.generating).toBe(false);
  });

  it('posts one exact batch request without child status requests', async () => {
    const {
      fetch, result, unmount
    } = renderRunningBatchContentStudio();

    await act(() => result.current.generateContentBatch(mockBatchRequest));

    const batchPosts = fetch.mock.calls.filter(([url, init]) => (
      String(url).endsWith('/generate-batch') && init?.method === 'POST'
    ));
    const childStatusRequests = fetch.mock.calls.filter(([url]) => (
      String(url).includes('/status/')
    ));
    expect(batchPosts).toHaveLength(1);
    expect(batchPosts[0]?.[1]?.body).toBe(JSON.stringify(mockBatchRequest));
    expect(childStatusRequests).toStrictEqual([]);
    unmount();
  });
});

describe('useContentStudio batch races', () => {
  it('clears an earlier error while a retry remains in flight', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const {
      result, unmount
    } = renderContentStudio(createMockFetch({ shouldFailBatchStart: true }));
    await act(() => result.current.generateContentBatch(mockBatchRequest));
    const deferred = createDeferredResponse();
    mockAuthenticatedFetch.mockReturnValueOnce(deferred.promise);

    act(() => { void result.current.generateContentBatch(mockBatchRequest); });

    expect({
      error: result.current.error,
      generating: result.current.generating,
    }).toStrictEqual({
      error: null,
      generating: true,
    });
    unmount();
    deferred.resolve(createMockJsonResponse(mockBatchStartResponse));
    await deferred.promise;
  });

  it('preserves both batches when start responses settle out of order', async () => {
    const {
      firstStart,
      secondStart,
      pendingBatches,
      result,
    } = renderConcurrentBatchStarts();

    secondStart.resolve(createMockJsonResponse(buildTerminalBatchStartResponse('batch-2')));
    await act(() => pendingBatches.second);
    firstStart.resolve(createMockJsonResponse(buildTerminalBatchStartResponse('batch-1')));
    await act(() => pendingBatches.first);

    expect(result.current.activeBatches.map((batch) => batch.batch_id)).toStrictEqual([
      'batch-1', 'batch-2'
    ]);
    expect(result.current.generating).toBe(false);
  });

  it('keeps a newer request generating when an older batch start fails first', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const {
      firstStart,
      secondStart,
      pendingBatches,
      result,
    } = renderConcurrentBatchStarts();

    firstStart.resolve(createMockJsonResponse({ error: 'Older failure' }, 500));
    await act(() => pendingBatches.first);

    expect({
      generating: result.current.generating,
      error: result.current.error,
    }).toStrictEqual({
      generating: true,
      error: null,
    });
    secondStart.resolve(createMockJsonResponse(buildTerminalBatchStartResponse('batch-2')));
    await act(() => pendingBatches.second);
  });

  it('does not apply a batch start response that settles after unmount', async () => {
    const deferred = deferAuthenticatedFetch();
    const {
      result, unmount
    } = renderHook(() => useContentStudio());
    const pendingStarts: Promise<ContentBriefBatchStartResponse | null>[] = [];
    act(() => {
      pendingStarts.push(result.current.generateContentBatch(mockBatchRequest));
    });

    unmount();
    deferred.resolve(createMockJsonResponse(mockBatchStartResponse));
    const received = await pendingStarts[0];

    expect(received?.batch_id).toBe('batch-1');
    expect(result.current.activeBatches).toStrictEqual([]);
  });

  it('polls when a batch starts with generating children and no pending children', async () => {
    const fetch = createMockFetch({
      batchStartResponse: buildGeneratingBatchStartResponse(),
      batchStatusResponse: buildRunningBatchStatusResponse(),
    });
    const {
      result, unmount
    } = renderContentStudio(fetch);

    await act(() => result.current.generateContentBatch(mockBatchRequest));
    await waitFor(() => {
      expect({
        statusRequests: batchStatusRequestUrls(fetch),
        generating: result.current.activeBatches[0]?.counts.generating,
      }).toStrictEqual({
        statusRequests: ['https://api.test.com/content-studio/batches/batch-1'],
        generating: 2,
      });
    });

    unmount();
  });
});
