import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  buildRunningBatchStatusResponse,
  createMockFetch,
  storeActiveContentStudioBatchIds,
} from './useContentStudio-fixtures';
import {
  prepareContentStudioHookTest, restoreContentStudioHookTest
} from './useContentStudio-test-fixtures';
import { useContentStudio } from './useContentStudio';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

beforeEach(prepareContentStudioHookTest);
afterEach(restoreContentStudioHookTest);

describe('useContentStudioBatchTracking no-op poll outcome', () => {
  it('does not rerender active cards when a status poll only reports an error', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    storeActiveContentStudioBatchIds(['batch-1']);
    const requestBehavior = {
      batchStatusResponse: buildRunningBatchStatusResponse(),
      shouldFailBatchStatus: false,
    };
    const fetch = createMockFetch(requestBehavior);
    mockAuthenticatedFetch.mockImplementation(fetch);
    const renderCount = { value: 0 };
    const { result } = renderHook(() => {
      renderCount.value += 1;
      return useContentStudio();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.activeBatches).toHaveLength(1);
    requestBehavior.shouldFailBatchStatus = true;
    const rendersBeforeError = renderCount.value;

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(renderCount.value).toBe(rendersBeforeError);
  });
});
