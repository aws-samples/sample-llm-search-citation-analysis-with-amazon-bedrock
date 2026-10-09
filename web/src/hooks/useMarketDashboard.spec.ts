import { waitFor } from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import {
  CHILEAN_PANEL_CITATIONS, CHILEAN_STATS, COMBINED_PANELS, renderMarketDashboard
} from './useMarketDashboard-fixtures';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

describe('useMarketDashboard', () => {
  it('returns the combined panels without a request when every market is shown', () => {
    const { result } = renderMarketDashboard(null);

    expect([result.current, mockAuthenticatedFetch.mock.calls]).toStrictEqual([{
      ...COMBINED_PANELS,
      marketId: null,
      loading: false,
      error: null,
    }, []]);
  });

  it('asks the stats and citations endpoints for the picked market', async () => {
    renderMarketDashboard('cl-es');

    await waitFor(() => expect(mockAuthenticatedFetch.mock.calls.map(([url]) => String(url)).sort((left, right) => left.localeCompare(right))).toStrictEqual([
      'https://api.test.com/citations?market_id=cl-es',
      'https://api.test.com/stats?market_id=cl-es',
    ]));
  });

  it('returns the picked market totals and charts once they arrive', async () => {
    const { result } = renderMarketDashboard('cl-es');

    await waitFor(() => expect(result.current).toStrictEqual({
      stats: CHILEAN_STATS,
      citations: CHILEAN_PANEL_CITATIONS,
      marketId: 'cl-es',
      loading: false,
      error: null,
    }));
  });

  it('reports the "No market" choice as the global market', async () => {
    renderMarketDashboard('global');

    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/stats?market_id=global', expect.anything(),
    ));
  });

  it('shows no totals and an error when the stats answer lacks a total', async () => {
    const { result } = renderMarketDashboard('cl-es', {
      total_searches: 8,
      market_id: 'cl-es',
    });

    await waitFor(() => expect([result.current.stats, result.current.error]).toStrictEqual([null, 'Invalid request']));
  });
});
