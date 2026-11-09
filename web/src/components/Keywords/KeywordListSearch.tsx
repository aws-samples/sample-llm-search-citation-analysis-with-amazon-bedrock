import {
  GLOBAL_MARKET_ID, type Market
} from '../../types';
import { SearchIcon } from '../ui';
import { TablePager } from '../ui/TablePager';
import { integerText } from '../ui/numberFormat';
import { MarketOptions } from './KeywordMarketControls';
import {
  ALL_KEYWORD_MARKETS, KEYWORD_PAGE_SIZES, type KeywordListPage, type KeywordStatusFilter
} from './useKeywordListPage';

interface KeywordListSearchProps {
  readonly list: KeywordListPage;
  /** Keywords in the current view before the search and filters. */
  readonly totalCount: number;
  /** The configured markets; the market filter is offered only when there are some. */
  readonly markets?: readonly Market[];
}

const FILTER_CLASS = 'py-2 pl-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900';

interface StatusOption {
  readonly value: KeywordStatusFilter;
  readonly label: string;
}

const STATUS_OPTIONS: readonly StatusOption[] = [
  {
    value: 'all',
    label: 'All statuses'
  },
  {
    value: 'active',
    label: 'Active keywords'
  },
  {
    value: 'paused',
    label: 'Paused keywords'
  },
];

/** "11 of 30 keywords" while a search or filter narrows the view, else "30 keywords". */
function countText(list: KeywordListPage, totalCount: number): string {
  if (list.narrowed) return `${integerText(list.matchingCount)} of ${integerText(totalCount)} keywords`;
  return `${integerText(totalCount)} ${totalCount === 1 ? 'keyword' : 'keywords'}`;
}

/** The table toolbar: search, status and market filters, and how many keywords the view holds. */
export const KeywordListSearch = ({
  list, totalCount, markets = []
}: KeywordListSearchProps) => (
  <div className="flex flex-wrap items-center gap-2">
    <div className="relative flex-1 min-w-[12rem] max-w-sm">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
      <input
        type="search"
        aria-label="Search keywords"
        placeholder="Search keywords..."
        value={list.query}
        onChange={(event) => list.setQuery(event.target.value)}
        className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
      />
    </div>
    <select aria-label="Filter by status" value={list.status} className={FILTER_CLASS}
      onChange={(event) => list.setStatus(event.target.value as KeywordStatusFilter)}>
      {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {markets.length > 0 && (
      <select aria-label="Filter by market" value={list.marketId} className={FILTER_CLASS}
        onChange={(event) => list.setMarketId(event.target.value)}>
        <option value={ALL_KEYWORD_MARKETS}>All markets</option>
        <option value={GLOBAL_MARKET_ID}>No market</option>
        <MarketOptions markets={markets} />
      </select>
    )}
    <span className="ml-auto text-sm text-gray-500 tabular-nums" aria-live="polite">
      {countText(list, totalCount)}
    </span>
  </div>
);

/** Previous / Next under the list; hidden while every match fits on the smallest page. */
export const KeywordListPager = ({ list }: { readonly list: KeywordListPage }) => (
  list.matchingCount <= KEYWORD_PAGE_SIZES[0] ? null : (
    <div className="px-4 py-3 border-t border-gray-200">
      <TablePager
        page={list.page}
        pageSize={list.pageSize}
        sizes={KEYWORD_PAGE_SIZES}
        totalCount={list.matchingCount}
        rowCount={list.pageItems.length}
        hasMore={list.hasMore}
        label="Keyword pages"
        onPage={list.setPage}
        onPageSize={list.setPageSize}
      />
    </div>
  )
);
