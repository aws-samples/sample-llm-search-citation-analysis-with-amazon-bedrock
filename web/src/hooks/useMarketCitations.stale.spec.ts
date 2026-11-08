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
import {
  STALE_REFETCH_INTERVAL_MS, STALE_REFETCH_LIMIT
} from './useStaleRefetch';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const staleSnapshot = buildCitationsPage({
  source: 'snapshot',
  as_of: '2026-10-12T07:14:05Z',
  stale: true,
  refreshing: true,
});

describe('useMarketCitations on a stale scope snapshot', () => {
  setupFakeTimersAndFetch();

  it('reads the page again 10 s after a stale snapshot answered', async () => {
    renderCitationTable({ body: staleSnapshot });
    await act(() => vi.advanceTimersByTimeAsync(0));

    await act(() => vi.advanceTimersByTimeAsync(STALE_REFETCH_INTERVAL_MS));

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the stale figures on screen without a loading state while it reads again', async () => {
    const { result } = renderCitationTable({ body: staleSnapshot });
    await act(() => vi.advanceTimersByTimeAsync(STALE_REFETCH_INTERVAL_MS));

    expect([result.current.loading, result.current.totals?.stale]).toStrictEqual([false, true]);
  });

  it('stops reading again after the refetch limit', async () => {
    renderCitationTable({ body: staleSnapshot });

    // One refetch per interval: the next timer starts once the page read in the previous one has rendered.
    await Array.from({ length: STALE_REFETCH_LIMIT + 5 }).reduce<Promise<void>>(async (previous) => {
      await previous;
      await act(() => vi.advanceTimersByTimeAsync(STALE_REFETCH_INTERVAL_MS));
    }, act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    }));

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(STALE_REFETCH_LIMIT + 1);
  });

  it('reads a current page once', async () => {
    renderCitationTable({
      body: buildCitationsPage({
        source: 'snapshot',
        stale: false 
      }) 
    });

    await act(() => vi.advanceTimersByTimeAsync(STALE_REFETCH_INTERVAL_MS * 3));

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
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
