import {
  describe, expect, it, vi
} from 'vitest';
import { waitFor } from '@testing-library/react';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  CHILEAN_CITATIONS, COMBINED_CITATIONS, renderMarketCitations
} from './useMarketCitations-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

describe('useMarketCitations', () => {
  it('returns the combined citations without a request when every market is shown', () => {
    const { result } = renderMarketCitations({ market: null });

    expect([result.current, mockAuthenticatedFetch.mock.calls]).toStrictEqual([{
      citations: COMBINED_CITATIONS,
      loading: false,
      error: null,
    }, []]);
  });

  it('asks the citations endpoint for the picked market only', async () => {
    renderMarketCitations({ market: 'cl-es' });

    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/citations?market_id=cl-es', expect.anything(),
    ));
  });

  it('returns the picked market citations once they arrive', async () => {
    const { result } = renderMarketCitations({ market: 'cl-es' });

    await waitFor(() => expect(result.current.citations).toStrictEqual(CHILEAN_CITATIONS.top_urls));
  });

  it('shows no citations and an error when the market read fails', async () => {
    const { result } = renderMarketCitations({
      market: 'cl-es',
      status: 500,
    });

    await waitFor(() => expect([result.current.citations, result.current.error === null]).toStrictEqual([[], false]));
  });
});
