import {
  describe, expect, it, vi
} from 'vitest';
import {
  renderHook, waitFor
} from '@testing-library/react';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { SHOW_ALL_ITEMS } from '../components/ui/pagination';
import {
  answerTwoCitationPages,
  buildCitationsPage,
  DEFAULT_TABLE_REQUEST,
  FIRST_OF_TWO,
  renderCitationTable,
  SECOND_OF_TWO,
} from './useMarketCitations-fixtures';
import { useMarketCitations } from './useMarketCitations';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

describe('useMarketCitations', () => {
  it('asks for the first page of every market combined with the page size as the limit', async () => {
    renderCitationTable();

    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/citations?limit=25&offset=0', expect.anything(),
    ));
  });

  it('sends the order, the filters, the market and the page offset to the API', async () => {
    renderCitationTable({
      market: 'cl-es',
      request: {
        sort: {
          column: 'domain',
          direction: 'asc',
        },
        urlContains: 'vuelos',
        minCitations: 2,
        contentType: 'video',
        page: 3,
        pageSize: 50,
      },
    });

    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/citations?sort=domain&order=asc&url_contains=vuelos&min_citations=2&content_type=video&market_id=cl-es&limit=50&offset=100',
      expect.anything(),
    ));
  });

  it('returns the page rows and the scope totals once they arrive', async () => {
    const page = buildCitationsPage();
    const { result } = renderCitationTable({ body: page });

    await waitFor(() => expect(result.current).toStrictEqual({
      citations: page.top_urls,
      totals: page,
      loading: false,
      error: null,
    }));
  });

  it('shows no citations and an error when the read fails', async () => {
    const { result } = renderCitationTable({ status: 500 });

    await waitFor(() => expect([result.current.citations, result.current.error === null]).toStrictEqual([[], false]));
  });

  it('follows every page when the page size is All', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    answerTwoCitationPages();

    const { result } = renderHook(() => useMarketCitations({
      ...DEFAULT_TABLE_REQUEST,
      pageSize: SHOW_ALL_ITEMS,
    }));

    await waitFor(() => expect(result.current.citations).toStrictEqual([FIRST_OF_TWO, SECOND_OF_TWO]));
  });
});
