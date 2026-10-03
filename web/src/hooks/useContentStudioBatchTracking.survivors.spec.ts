import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  buildRunningBatchStatusResponse,
  createMockFetch,
  renderContentStudioScenario,
  storeActiveContentStudioBatchIds,
} from './useContentStudio-fixtures';
import {
  advanceContentStudioPoll, flushContentStudioPromises
} from './useContentStudioBatchTracking-fixtures';
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
    const renderCount = { value: 0 };
    const { result } = renderContentStudioScenario(() => {
      renderCount.value += 1;
      return useContentStudio();
    }, createMockFetch(requestBehavior));
    await flushContentStudioPromises();
    expect(result.current.activeBatches).toHaveLength(1);
    requestBehavior.shouldFailBatchStatus = true;
    const rendersBeforeError = renderCount.value;

    await advanceContentStudioPoll();

    expect(renderCount.value).toBe(rendersBeforeError);
  });
});
