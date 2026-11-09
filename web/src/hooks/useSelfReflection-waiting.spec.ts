import {
  afterEach, beforeEach, describe, it, expect, vi
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import {
  SELF_REFLECTION_GAVE_UP, SELF_REFLECTION_WAIT_LIMIT_MS, useSelfReflection
} from './useSelfReflection';
import {
  SELF_REFLECTION_STATUS_URL,
  failedSelfReflection,
  finishedSelfReflection,
  mockSelfReflection,
  pendingSelfReflection,
  runningSelfReflection,
} from './useSelfReflection-fixtures';
import {
  advanceFakeTime, runEachTestWithFakeTimers
} from '../test/fakeTime';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { createMockJsonResponse } from '../test/fetchResponses';
import {
  emitLive, liveSubscriberCount, resetLiveEvents
} from '../test/liveEventsMock';

// Hoisted above the imports: the hook reaches the API through the mocked infrastructure.
vi.mock('../infrastructure', () => import('../test/infrastructureMock'));
vi.mock('../infrastructure/liveEvents', () => import('../test/liveEventsMock'));

/** Renders the hook and triggers the reflection the fixtures describe, answered by `responses` in order. */
async function renderTriggered(...responses: unknown[]) {
  for (const response of responses) {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(response, response === pendingSelfReflection ? 202 : 200));
  }
  const hook = renderHook(() => useSelfReflection());
  await act(() => hook.result.current.triggerReflection('hotels in madrid', 'Hotel Sol', 'prompt-family'));
  return hook;
}

const FINISHED = {
  type: 'self-reflection.finished',
  keyword: 'hotels in madrid',
  brand: 'Hotel Sol',
  query_prompt_id: 'prompt-family',
  status: 'done',
};

describe('useSelfReflection while the analysis runs in the background', () => {
  runEachTestWithFakeTimers();

  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  afterEach(() => {
    resetLiveEvents();
  });

  it('checks the analysis once when it starts listening, to catch up', async () => {
    await renderTriggered(pendingSelfReflection, runningSelfReflection);

    await advanceFakeTime(0);

    expect(mockAuthenticatedFetch).toHaveBeenLastCalledWith(SELF_REFLECTION_STATUS_URL, { signal: expect.any(AbortSignal) });
  });

  it('keeps loading while the analysis is pending', async () => {
    const { result } = await renderTriggered(pendingSelfReflection, runningSelfReflection);

    await advanceFakeTime(0);

    expect(result.current).toStrictEqual({
      data: null,
      loading: true,
      error: null,
      triggerReflection: expect.any(Function),
    });
  });

  it('shows the reflection once its finished event arrives', async () => {
    const { result } = await renderTriggered(pendingSelfReflection, runningSelfReflection, finishedSelfReflection);
    await advanceFakeTime(0);

    await emitLive('insights', FINISHED);

    expect(result.current).toStrictEqual({
      data: mockSelfReflection,
      loading: false,
      error: null,
      triggerReflection: expect.any(Function),
    });
  });

  it.each([
    ['another keyword', { keyword: 'hotels in seville' }],
    ['another brand', { brand: 'Hotel Luna' }],
    ['another persona', { query_prompt_id: 'prompt-business' }],
    ['a narrative', { type: 'narrative.finished' }],
  ])('ignores the event of %s', async (_case, fields) => {
    await renderTriggered(pendingSelfReflection, runningSelfReflection, finishedSelfReflection);
    await advanceFakeTime(0);

    await emitLive('insights', {
      ...FINISHED,
      ...fields 
    });

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('stops listening once the analysis finished', async () => {
    await renderTriggered(pendingSelfReflection, finishedSelfReflection);

    await advanceFakeTime(0);

    expect([mockAuthenticatedFetch.mock.calls.length, liveSubscriberCount('insights')]).toStrictEqual([2, 0]);
  });

  it('reports why the analysis failed', async () => {
    const { result } = await renderTriggered(pendingSelfReflection, failedSelfReflection);

    await advanceFakeTime(0);

    expect([result.current.error, result.current.loading]).toStrictEqual(['The AI model did not answer in time; try again', false]);
  });

  it('gives up after the wait limit without reading on a timer', async () => {
    mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(createMockJsonResponse(runningSelfReflection)));
    const { result } = await renderTriggered(pendingSelfReflection);

    await advanceFakeTime(SELF_REFLECTION_WAIT_LIMIT_MS);

    expect([result.current.error, mockAuthenticatedFetch.mock.calls.length, liveSubscriberCount('insights')]).toStrictEqual([
      SELF_REFLECTION_GAVE_UP, 2, 0,
    ]);
  });

  it('stops listening when the panel unmounts', async () => {
    const { unmount } = await renderTriggered(pendingSelfReflection, runningSelfReflection);

    unmount();

    expect(liveSubscriberCount('insights')).toBe(0);
  });

  it('never listens when the reflection came back at once', async () => {
    await renderTriggered(mockSelfReflection);

    await advanceFakeTime(0);

    expect([mockAuthenticatedFetch.mock.calls.length, liveSubscriberCount('insights')]).toStrictEqual([1, 0]);
  });
});
