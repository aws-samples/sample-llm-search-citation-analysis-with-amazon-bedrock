import { useMemo } from 'react';
import type {
  CitationsPage, TopUrl
} from '../../types';
import {
  citationListParams, fetchCitationsPage, type CitationListQuery
} from '../../api/citationPages';
import { useMarketCitations } from '../../hooks/useMarketCitations';
import {
  useContinuedPages, type ContinuedPages
} from '../../hooks/useContinuedPages';
import type { CursorPage } from '../../api/cursorPages';
import { useSelectedMarketId } from '../Markets/marketSelectionContext';

/** URLs per request as the reader scrolls. */
export const CITATIONS_SCROLL_PAGE = 50;

export interface CitationPages extends Omit<ContinuedPages<TopUrl>, 'items'> {
  /** Every URL loaded so far for the current order and filters, in the API's order. */
  readonly rows: readonly TopUrl[];
  /** The first page's scope-wide totals; `null` until it arrives. */
  readonly totals: CitationsPage | null;
  /** The first page of the current order and filters is being fetched. */
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The Citations table as one growing list: the first `CITATIONS_SCROLL_PAGE`
 * URLs of `query` for the header's market, then the next page each time
 * `loadMore` is called. A new order, filter or market starts again from the
 * top; pages of the previous query are never appended.
 */
export function useCitationPages(query: Omit<CitationListQuery, 'marketId'>): CitationPages {
  const marketId = useSelectedMarketId();
  const view = useMarketCitations({
    ...query,
    page: 1,
    pageSize: CITATIONS_SCROLL_PAGE,
  });
  const { totals } = view;
  const first = useMemo<CursorPage<TopUrl> | null>(() => (totals === null ? null : {
    items: totals.top_urls,
    nextToken: totals.next_token,
  }), [totals]);
  const params = {
    ...citationListParams({
      ...query,
      marketId,
    }),
    limit: String(CITATIONS_SCROLL_PAGE),
  };
  // While a new order or filter loads, the rows on screen belong to the old one: append nothing to them.
  const pages = useContinuedPages(first, async (nextToken, signal) => {
    const page = await fetchCitationsPage({
      ...params,
      next_token: nextToken,
    }, signal);
    return {
      items: page.top_urls,
      nextToken: page.next_token,
    };
  }, (url) => url.url, view.loading);

  return {
    rows: pages.items,
    totals,
    loading: view.loading,
    error: view.error,
    hasMore: pages.hasMore,
    loadingMore: pages.loadingMore,
    failed: pages.failed,
    loadMore: pages.loadMore,
  };
}
