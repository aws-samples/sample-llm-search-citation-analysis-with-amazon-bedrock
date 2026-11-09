import {
  useMemo, useState
} from 'react';
import type { Keyword } from '../../types';
import { keywordMarketId } from '../Markets/marketSelection';
import { paginate } from '../ui/pagination';
import { isKeywordActive } from './keywordEntry';

export const KEYWORD_PAGE_SIZES = [25, 50, 100] as const;
type KeywordPageSize = typeof KEYWORD_PAGE_SIZES[number];

/** Which keywords the status filter keeps. */
export type KeywordStatusFilter = 'all' | 'active' | 'paused';
/** The market filter that keeps every market; any other value is a market id (the global id for no market). */
export const ALL_KEYWORD_MARKETS = 'all';

interface KeywordListFilters {
  readonly query: string;
  readonly status: KeywordStatusFilter;
  readonly marketId: string;
}

/** Whether `keyword`'s text contains `query`, ignoring case and surrounding spaces; a blank query matches all. */
function matchesKeywordSearch(keyword: Pick<Keyword, 'keyword'>, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return needle === '' || keyword.keyword.toLocaleLowerCase().includes(needle);
}

function matchesStatus(keyword: Keyword, status: KeywordStatusFilter): boolean {
  if (status === 'all') return true;
  return isKeywordActive(keyword) === (status === 'active');
}

function matchesFilters(keyword: Keyword, filters: KeywordListFilters): boolean {
  return matchesKeywordSearch(keyword, filters.query)
    && matchesStatus(keyword, filters.status)
    && (filters.marketId === ALL_KEYWORD_MARKETS || keywordMarketId(keyword) === filters.marketId);
}

/**
 * The text search, the status and market filters and the page over the
 * keyword list, all client-side: the manager already holds every keyword. A
 * new search, filter or page size starts again at page 1, and the page is
 * clamped when deletes shrink the list.
 */
export function useKeywordListPage(keywords: readonly Keyword[]) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<KeywordStatusFilter>('all');
  const [marketId, setMarketId] = useState<string>(ALL_KEYWORD_MARKETS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<KeywordPageSize>(KEYWORD_PAGE_SIZES[0]);

  const matching = useMemo(
    () => keywords.filter((keyword) => matchesFilters(keyword, {
      query,
      status,
      marketId
    })),
    [keywords, query, status, marketId]
  );
  const lastPage = Math.max(1, Math.ceil(matching.length / pageSize));
  const currentPage = Math.min(page, lastPage);
  const { pageItems } = paginate(matching, currentPage, pageSize);

  return {
    query,
    setQuery: (next: string) => { setQuery(next); setPage(1); },
    status,
    setStatus: (next: KeywordStatusFilter) => { setStatus(next); setPage(1); },
    marketId,
    setMarketId: (next: string) => { setMarketId(next); setPage(1); },
    /** Whether the search or a filter narrows the list. */
    narrowed: query.trim() !== '' || status !== 'all' || marketId !== ALL_KEYWORD_MARKETS,
    page: currentPage,
    setPage,
    pageSize,
    setPageSize: (next: KeywordPageSize) => { setPageSize(next); setPage(1); },
    matchingCount: matching.length,
    hasMore: currentPage < lastPage,
    pageItems,
  };
}

export type KeywordListPage = ReturnType<typeof useKeywordListPage>;
