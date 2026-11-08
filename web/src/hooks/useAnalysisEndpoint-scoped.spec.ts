import {
  describe, expect, it, vi
} from 'vitest';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import {
  STALE_REFETCH_INTERVAL_MS, STALE_REFETCH_LIMIT
} from './useStaleRefetch';
import { answerEveryFetch } from '../test/fetchStubs';
import { act } from '@testing-library/react';
import { fixtureBody } from '../types/domain/scopeCoverage-fixtures';
import { scopedFixture } from '../test/scopedFixtures';
import {
  answerFetchesInOrder, awaitThenAdvance, setupFakeTimersAndFetch, startThenAdvance
} from '../test/scopedTestKit';
import {
  probeResponse, renderProbeEndpoint
} from './useAnalysisEndpoint-fixtures';

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const computingBody = fixtureBody('visibility', 'computing');
const staleProbe = {
  ...probeResponse,
  stale: true,
  refreshing: true,
};
const currentProbe = {
  ...probeResponse,
  score: 50,
  stale: false,
  refreshing: false,
};
const malformedCoverage = {
  ...probeResponse,
  coverage: {
    keywords_total: 2,
    keywords_analyzed: 3,
    complete: true,
  },
};
const scopedProbe = {
  ...probeResponse,
  ...scopedFixture('visibility', 'live'),
};

/**
 * Renders the probe endpoint, fetches 'best hotels' and lets `ms` of fake time pass. `polled`
 * starts the fetch without awaiting it, as a `202` answer is polled.
 */
async function renderProbeFetched(ms: number, polled = false) {
  const rendered = renderProbeEndpoint();
  const advance = polled ? startThenAdvance : awaitThenAdvance;
  await advance(() => rendered.result.current.fetchData('best hotels'), ms);
  return rendered;
}

describe('useAnalysisEndpoint with 2.45.0 scoped answers', () => {
  setupFakeTimersAndFetch();

  it('holds the view job in computing while a 202 answer is polled', async () => {
    answerEveryFetch(computingBody, 202);

    const { result } = await renderProbeFetched(0, true);

    expect(result.current.computing).toStrictEqual(computingBody);
  });

  it('stores the 200 body and clears computing when the job finishes', async () => {
    answerFetchesInOrder([computingBody, 202], [probeResponse, 200]);

    const { result } = await renderProbeFetched(2_000, true);

    expect([result.current.data, result.current.computing, result.current.loading]).toStrictEqual([probeResponse, null, false]);
  });

  it('refetches a stale answer after 10 s and stores the current one', async () => {
    answerFetchesInOrder([staleProbe, 200], [currentProbe, 200]);

    const { result } = await renderProbeFetched(STALE_REFETCH_INTERVAL_MS);

    expect(result.current.data).toStrictEqual(currentProbe);
  });

  it('keeps loading false while a stale answer is refetched in the background', async () => {
    answerFetchesInOrder([staleProbe, 200]);
    mockAuthenticatedFetch.mockReturnValueOnce(new Promise(vi.fn()));

    const { result } = await renderProbeFetched(STALE_REFETCH_INTERVAL_MS);

    expect([result.current.loading, result.current.data]).toStrictEqual([false, staleProbe]);
  });

  it.each([
    ['stops refetching a stale answer after the refetch limit', staleProbe, STALE_REFETCH_LIMIT + 5, STALE_REFETCH_LIMIT + 1],
    ['sends no refetch after a current answer', currentProbe, 3, 1],
  ])('%s', async (_name, body, intervals, calls) => {
    answerEveryFetch(body);

    await renderProbeFetched(STALE_REFETCH_INTERVAL_MS * intervals);

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(calls);
  });

  it('cancels the pending stale refetch on reset', async () => {
    answerEveryFetch(staleProbe);
    const { result } = await renderProbeFetched(0);

    act(() => { result.current.reset(); });
    await act(() => vi.advanceTimersByTimeAsync(STALE_REFETCH_INTERVAL_MS * 2));

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rejects a body whose coverage is malformed', malformedCoverage, null, 'Invalid visibility request'],
    ['accepts a scoped body carrying every 2.45.0 field', scopedProbe, scopedProbe, null],
  ])('%s', async (_name, body, data, error) => {
    answerEveryFetch(body);

    const { result } = await renderProbeFetched(0);

    expect([result.current.data, result.current.error]).toStrictEqual([data, error]);
  });

  it('clears the pending stale refetch timer on unmount', async () => {
    answerEveryFetch(staleProbe);
    const { unmount } = await renderProbeFetched(0);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const callsBefore = clearTimeoutSpy.mock.calls.length;

    unmount();

    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
