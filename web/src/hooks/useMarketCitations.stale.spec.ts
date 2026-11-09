import {
  afterEach, describe, expect, it, vi
} from 'vitest';
import { act } from '@testing-library/react';
import {
  buildCitationsPage, renderCitationTable
} from './useMarketCitations-fixtures';
import { isCitationsPage } from '../api/citationPages';
import { fixtureBody } from '../types/domain/scopeCoverage-fixtures';
import { setupFakeTimersAndFetch } from '../test/scopedTestKit';
import { STALE_REFETCH_LIMIT } from './useStaleRefetch';
import {
  emitLive, liveSubscriberCount, resetLiveEvents
} from '../test/liveEventsMock';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));
vi.mock('../infrastructure/liveEvents', () => import('../test/liveEventsMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const staleSnapshot = buildCitationsPage({
  source: 'snapshot',
  as_of: '2026-10-12T07:14:05Z',
  stale: true,
  refreshing: true,
});

const BUILT = {
  type: 'scope-snapshots.built',
  status: 'built' 
};

describe('useMarketCitations on a stale scope snapshot', () => {
  setupFakeTimersAndFetch();
  afterEach(() => {
    resetLiveEvents();
  });

  it('reads the page again once it listens for the rebuild, to catch up', async () => {
    renderCitationTable({ body: staleSnapshot });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('reads the page again when a snapshot build ends', async () => {
    renderCitationTable({ body: staleSnapshot });
    await act(() => vi.advanceTimersByTimeAsync(0));

    await emitLive('snapshots', BUILT);
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(3);
  });

  it('keeps the stale figures on screen without a loading state while it reads again', async () => {
    const { result } = renderCitationTable({ body: staleSnapshot });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect([result.current.loading, result.current.totals?.stale]).toStrictEqual([false, true]);
  });

  it('stops reading again after the refetch limit', async () => {
    renderCitationTable({ body: staleSnapshot });

    await Array.from({ length: STALE_REFETCH_LIMIT + 5 }).reduce<Promise<void>>(async (previous) => {
      await previous;
      await emitLive('snapshots', BUILT);
      await act(() => vi.advanceTimersByTimeAsync(0));
    }, act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    }));

    expect([mockAuthenticatedFetch.mock.calls.length, liveSubscriberCount('snapshots')]).toStrictEqual([STALE_REFETCH_LIMIT + 1, 0]);
  });

  it('reads a current page once and listens for nothing', async () => {
    renderCitationTable({
      body: buildCitationsPage({
        source: 'snapshot',
        stale: false 
      }) 
    });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect([mockAuthenticatedFetch.mock.calls.length, liveSubscriberCount('snapshots')]).toStrictEqual([1, 0]);
  });
});

describe('isCitationsPage on 2.45.0 bodies', () => {
  it.each(['complete', 'live', 'stale'])('accepts the %s citations fixture', (caseName) => {
    expect(isCitationsPage(fixtureBody('citations', caseName))).toBe(true);
  });

  it('rejects a page whose coverage is malformed', () => {
    expect(isCitationsPage({
      ...buildCitationsPage(),
      coverage: { keywords_total: 'many' },
    })).toBe(false);
  });
});
