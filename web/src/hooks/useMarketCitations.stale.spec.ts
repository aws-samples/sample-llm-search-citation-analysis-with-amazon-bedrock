import {
  describe, expect, it, vi
} from 'vitest';
import { act } from '@testing-library/react';
import {
  buildCitationsPage, renderCitationTable
} from './useMarketCitations-fixtures';
import { isCitationsPage } from '../api/citationPages';
import { fixtureBody } from '../types/domain/scopeCoverage-fixtures';
import { setupFakeTimersAndFetch } from '../test/scopedTestKit';
import { STALE_REFETCH_LIMIT } from './useStaleRefetch';
import { emitLive } from '../test/liveEventsMock';
import {
  SNAPSHOTS_BUILT_EVENT, emitLiveRepeatedly, readsAndListeners
} from '../test/liveReadCounts';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const staleSnapshot = buildCitationsPage({
  source: 'snapshot',
  as_of: '2026-10-12T07:14:05Z',
  stale: true,
  refreshing: true,
});

/** Renders the table over a stale snapshot and lets its first read and the catch-up read settle. */
async function renderStaleTable() {
  const view = renderCitationTable({ body: staleSnapshot });
  await act(() => vi.advanceTimersByTimeAsync(0));
  return view;
}

describe('useMarketCitations on a stale scope snapshot', () => {
  setupFakeTimersAndFetch();
  it('reads the page again once it listens for the rebuild, to catch up', async () => {
    await renderStaleTable();

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('reads the page again when a snapshot build ends', async () => {
    await renderStaleTable();

    await emitLive('snapshots', SNAPSHOTS_BUILT_EVENT);
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(3);
  });

  it('keeps the stale figures on screen without a loading state while it reads again', async () => {
    const { result } = await renderStaleTable();

    expect([result.current.loading, result.current.totals?.stale]).toStrictEqual([false, true]);
  });

  it('stops reading again after the refetch limit', async () => {
    await renderStaleTable();

    await emitLiveRepeatedly('snapshots', SNAPSHOTS_BUILT_EVENT, STALE_REFETCH_LIMIT + 5, () => act(() => vi.advanceTimersByTimeAsync(0)));

    expect(readsAndListeners('snapshots')).toStrictEqual([STALE_REFETCH_LIMIT + 1, 0]);
  });

  it('reads a current page once and listens for nothing', async () => {
    renderCitationTable({
      body: buildCitationsPage({
        source: 'snapshot',
        stale: false 
      }) 
    });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(readsAndListeners('snapshots')).toStrictEqual([1, 0]);
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
