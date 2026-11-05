import {
  beforeEach, describe, it, expect, vi
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import {
  SELF_REFLECTION_GAVE_UP, SELF_REFLECTION_MAX_POLLS, SELF_REFLECTION_POLL_INTERVAL_MS, useSelfReflection
} from './useSelfReflection';
import {
  SELF_REFLECTION_STATUS_URL,
  failedSelfReflection,
  finishedSelfReflection,
  mockSelfReflection,
  pendingSelfReflection,
  runningSelfReflection,
} from './useSelfReflection-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import {
  advanceFakeTime, runEachTestWithFakeTimers
} from '../test/fakeTime';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

/** Renders the hook and triggers the reflection the fixtures describe, answered by `responses` in order. */
async function renderTriggered(...responses: unknown[]) {
  for (const response of responses) {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(response, response === pendingSelfReflection ? 202 : 200));
  }
  const hook = renderHook(() => useSelfReflection());
  await act(() => hook.result.current.triggerReflection('hotels in madrid', 'Hotel Sol', 'prompt-family'));
  return hook;
}

/** Lets `count` poll intervals pass one by one, so each check's answer arrives before the next interval starts. */
async function waitPollIntervals(count: number) {
  await Array.from({ length: count }).reduce<Promise<void>>(
    (previous) => previous.then(() => advanceFakeTime(SELF_REFLECTION_POLL_INTERVAL_MS)),
    Promise.resolve(),
  );
}

describe('useSelfReflection while the analysis runs in the background', () => {
  runEachTestWithFakeTimers();

  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('checks the analysis once the poll interval has passed', async () => {
    await renderTriggered(pendingSelfReflection, runningSelfReflection);

    await advanceFakeTime(SELF_REFLECTION_POLL_INTERVAL_MS);

    expect(mockAuthenticatedFetch).toHaveBeenLastCalledWith(SELF_REFLECTION_STATUS_URL, { signal: expect.any(AbortSignal) });
  });

  it('keeps loading while the analysis is pending', async () => {
    const { result } = await renderTriggered(pendingSelfReflection, runningSelfReflection);

    await advanceFakeTime(SELF_REFLECTION_POLL_INTERVAL_MS);

    expect(result.current).toStrictEqual({
      data: null,
      loading: true,
      error: null,
      triggerReflection: expect.any(Function),
    });
  });

  it('shows the reflection once the analysis finished', async () => {
    const { result } = await renderTriggered(pendingSelfReflection, runningSelfReflection, finishedSelfReflection);

    await waitPollIntervals(2);

    expect(result.current).toStrictEqual({
      data: mockSelfReflection,
      loading: false,
      error: null,
      triggerReflection: expect.any(Function),
    });
  });

  it('stops checking once the analysis finished', async () => {
    await renderTriggered(pendingSelfReflection, finishedSelfReflection);

    await waitPollIntervals(3);

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('reports why the analysis failed', async () => {
    const { result } = await renderTriggered(pendingSelfReflection, failedSelfReflection);

    await advanceFakeTime(SELF_REFLECTION_POLL_INTERVAL_MS);

    expect([result.current.error, result.current.loading]).toStrictEqual(['The AI model did not answer in time; try again', false]);
  });

  it('gives up after the last allowed check', async () => {
    mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(createMockJsonResponse(runningSelfReflection)));
    const { result } = await renderTriggered(pendingSelfReflection);

    await waitPollIntervals(SELF_REFLECTION_MAX_POLLS + 2);

    expect([result.current.error, mockAuthenticatedFetch.mock.calls.length]).toStrictEqual([SELF_REFLECTION_GAVE_UP, SELF_REFLECTION_MAX_POLLS + 1]);
  });

  it('stops checking when the panel unmounts', async () => {
    const { unmount } = await renderTriggered(pendingSelfReflection, runningSelfReflection);

    unmount();
    await waitPollIntervals(2);

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it('never checks when the reflection came back at once', async () => {
    await renderTriggered(mockSelfReflection);

    await waitPollIntervals(2);

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });
});
