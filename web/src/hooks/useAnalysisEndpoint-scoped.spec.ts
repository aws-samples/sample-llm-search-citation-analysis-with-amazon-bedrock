import {
  afterEach, describe, expect, it, vi
} from 'vitest';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));
vi.mock('../infrastructure/liveEvents', () => import('../test/liveEventsMock'));

import { STALE_REFETCH_LIMIT } from './useStaleRefetch';
import {
  emitLive, liveSubscriberCount, resetLiveEvents
} from '../test/liveEventsMock';
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
  afterEach(() => {
    resetLiveEvents();
  });

  it('holds the view job in computing while it waits for a 202 answer’s job', async () => {
    answerEveryFetch(computingBody, 202);

    const { result } = await renderProbeFetched(0, true);

    expect(result.current.computing).toStrictEqual(computingBody);
  });

  it('stores the 200 body and clears computing when the job finishes', async () => {
    answerFetchesInOrder([computingBody, 202], [probeResponse, 200]);

    const { result } = await renderProbeFetched(0, true);

    expect([result.current.data, result.current.computing, result.current.loading]).toStrictEqual([probeResponse, null, false]);
  });

  it('reads a stale answer again once it listens for the rebuild, and stores the current one', async () => {
    answerFetchesInOrder([staleProbe, 200], [currentProbe, 200]);

    const { result } = await renderProbeFetched(0);

    expect([result.current.data, liveSubscriberCount('snapshots')]).toStrictEqual([currentProbe, 0]);
  });

  it('reads it again when a snapshot build ends', async () => {
    answerFetchesInOrder([staleProbe, 200], [staleProbe, 200], [currentProbe, 200]);
    const { result } = await renderProbeFetched(0);

    await emitLive('snapshots', {
      type: 'scope-snapshots.built',
      status: 'built' 
    });

    expect([result.current.data, mockAuthenticatedFetch.mock.calls.length]).toStrictEqual([currentProbe, 3]);
  });

  it('ignores a build that only started', async () => {
    answerFetchesInOrder([staleProbe, 200], [staleProbe, 200]);
    await renderProbeFetched(0);

    await emitLive('snapshots', {
      type: 'execution.status',
      status: 'RUNNING' 
    });

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps loading false while a stale answer is refetched in the background', async () => {
    answerFetchesInOrder([staleProbe, 200]);
    mockAuthenticatedFetch.mockReturnValueOnce(new Promise(vi.fn()));

    const { result } = await renderProbeFetched(0);

    expect([result.current.loading, result.current.data]).toStrictEqual([false, staleProbe]);
  });

  it('stops refetching a stale answer after the refetch limit', async () => {
    answerEveryFetch(staleProbe);
    await renderProbeFetched(0);

    await Array.from({ length: STALE_REFETCH_LIMIT + 5 }).reduce<Promise<void>>(async (previous) => {
      await previous;
      await emitLive('snapshots', {
        type: 'scope-snapshots.built',
        status: 'built' 
      });
    }, Promise.resolve());

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(STALE_REFETCH_LIMIT + 1);
  });

  it('listens for nothing after a current answer', async () => {
    answerEveryFetch(currentProbe);

    await renderProbeFetched(0);

    expect([mockAuthenticatedFetch.mock.calls.length, liveSubscriberCount('snapshots')]).toStrictEqual([1, 0]);
  });

  it('cancels the pending stale refetch on reset', async () => {
    answerFetchesInOrder([staleProbe, 200]);
    mockAuthenticatedFetch.mockReturnValueOnce(new Promise(vi.fn()));
    const { result } = await renderProbeFetched(0);

    act(() => { result.current.reset(); });

    expect(liveSubscriberCount('snapshots')).toBe(0);
  });

  it.each([
    ['rejects a body whose coverage is malformed', malformedCoverage, null, 'Invalid visibility request'],
    ['accepts a scoped body carrying every 2.45.0 field', scopedProbe, scopedProbe, null],
  ])('%s', async (_name, body, data, error) => {
    answerEveryFetch(body);

    const { result } = await renderProbeFetched(0);

    expect([result.current.data, result.current.error]).toStrictEqual([data, error]);
  });

  it('stops listening for the rebuild on unmount', async () => {
    answerFetchesInOrder([staleProbe, 200]);
    mockAuthenticatedFetch.mockReturnValueOnce(new Promise(vi.fn()));
    const { unmount } = await renderProbeFetched(0);

    unmount();

    expect(liveSubscriberCount('snapshots')).toBe(0);
  });
});
