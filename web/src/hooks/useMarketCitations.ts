import {
  useEffect, useState
} from 'react';
import type {
  CitationsPage, TopUrl
} from '../types';
import {
  citationListParams,
  DASHBOARD_CITATIONS_LIMIT,
  fetchCitationsPage,
  isCitationsPage,
  MAX_CITATIONS_PAGE,
  type CitationListQuery,
} from '../api/citationPages';
import {
  collectCursorPages, withNextToken
} from '../api/cursorPages';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';
import { SHOW_ALL_ITEMS } from '../components/ui/pagination';
import {
  getErrorMessage, isAbortError
} from '../infrastructure';
import { apiRequestErrors } from './useAnalysisEndpoint';
import {
  STALE_REFETCH_INTERVAL_MS, STALE_REFETCH_LIMIT
} from './useStaleRefetch';

/**
 * `GET /citations?market_id=&limit=`: one market's provider, brand and
 * content-type totals with its first few URLs (the dashboard charts).
 */
export const marketCitationsEndpoint = {
  errorContext: 'citations',
  logMessage: '[citations] Error fetching market citations:',
  isValidResponse: isCitationsPage,
  ...apiRequestErrors('Failed to fetch citations'),
  buildRequest: (marketId: string) => ({
    path: '/citations',
    params: new URLSearchParams({
      market_id: marketId,
      limit: String(DASHBOARD_CITATIONS_LIMIT),
    }),
  }),
};

/** The Citations table's order, filters and page window (one-based `page`; `SHOW_ALL_ITEMS` = every URL). */
export interface CitationTableRequest extends Omit<CitationListQuery, 'marketId'> {
  readonly page: number;
  readonly pageSize: number;
}

export interface MarketCitations {
  /** The URLs of the requested page; empty until the first page arrives. */
  readonly citations: TopUrl[];
  /** The page's scope-wide totals; `null` until the first page arrives. */
  readonly totals: CitationsPage | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/** The request's query parameters, for the header's market. */
function tableParams(request: CitationTableRequest, marketId: string | null): Record<string, string> {
  const params = citationListParams({
    ...request,
    marketId,
  });
  if (request.pageSize === SHOW_ALL_ITEMS) return {
    ...params,
    limit: String(MAX_CITATIONS_PAGE),
  };
  return {
    ...params,
    limit: String(request.pageSize),
    offset: String((request.page - 1) * request.pageSize),
  };
}

/** The first page with every later page's URLs appended (the "All" page size). */
async function fetchWholeList(params: Record<string, string>, signal: AbortSignal): Promise<CitationsPage> {
  const first = await fetchCitationsPage(params, signal);
  if (first.next_token === null) return first;
  const rest = await collectCursorPages(async (nextToken) => {
    const page = await fetchCitationsPage(withNextToken(params, nextToken ?? first.next_token) ?? params, signal);
    return {
      items: page.top_urls,
      nextToken: page.next_token,
    };
  });
  return {
    ...first,
    top_urls: [...first.top_urls, ...rest],
    next_token: null,
  };
}

interface Loaded {
  readonly key: string;
  readonly page: CitationsPage | null;
  readonly error: string | null;
}

/**
 * The refetch round of request `key`: while its page is a stale snapshot being rebuilt, the round
 * goes up every 10 s (at most 18 times) so the page is read again; a new request starts at 0.
 */
function useStaleSnapshotRound(key: string, loaded: Loaded | null): number {
  const [refetch, setRefetch] = useState({
    key,
    round: 0,
  });
  const round = refetch.key === key ? refetch.round : 0;
  const stalePage = loaded?.key === key && loaded.page?.stale === true && loaded.page.source !== 'live';

  useEffect(() => {
    if (!stalePage || round >= STALE_REFETCH_LIMIT) return undefined;
    const timer = setTimeout(() => setRefetch({
      key,
      round: round + 1,
    }), STALE_REFETCH_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [stalePage, round, key, loaded]);
  return round;
}

/**
 * The Citations table's page for the header's market (every market combined
 * when none is picked), sorted, filtered and paged by the API; requested
 * again whenever the market or `request` changes.
 */
export function useMarketCitations(request: CitationTableRequest): MarketCitations {
  const marketId = useSelectedMarketId();
  const {
    sort: {
      column, direction
    }, urlContains, minCitations, contentType, page, pageSize,
  } = request;
  const key = JSON.stringify([column, direction, urlContains, minCitations, contentType, page, pageSize, marketId]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const round = useStaleSnapshotRound(key, loaded);

  useEffect(() => {
    const controller = new AbortController();
    const params = tableParams({
      sort: {
        column,
        direction,
      },
      urlContains,
      minCitations,
      contentType,
      page,
      pageSize,
    }, marketId);
    const read = pageSize === SHOW_ALL_ITEMS
      ? fetchWholeList(params, controller.signal)
      : fetchCitationsPage(params, controller.signal);
    read.then(
      (citationsPage) => setLoaded({
        key,
        page: citationsPage,
        error: null,
      }),
      (readError: unknown) => {
        if (isAbortError(readError)) return;
        console.error('[citations] Error fetching citations:', readError);
        setLoaded({
          key,
          page: null,
          error: getErrorMessage(readError),
        });
      }
    );
    return () => controller.abort();
  }, [key, round, column, direction, urlContains, minCitations, contentType, page, pageSize, marketId]);

  return {
    citations: loaded?.page?.top_urls ?? [],
    totals: loaded?.page ?? null,
    loading: loaded?.key !== key,
    error: loaded?.error ?? null,
  };
}
