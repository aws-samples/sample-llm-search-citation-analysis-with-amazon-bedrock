import React, { useState } from 'react';
import type {
  CitationsPage, CrawledContent, TopUrl
} from '../../types';
import {
  API_BASE_URL, authenticatedFetch 
} from '../../infrastructure';
import { KeywordDetail } from '../Keywords/KeywordDetail';
import { CitationDetailModal } from './CitationDetailModal';
import { CitationFilters } from './CitationFilters';
import { CitationTableHeader } from './CitationTableHeader';
import { CitationRow } from './CitationRow';
import { CitationsAsOf } from './CitationsAsOf';
import { LoadOnScrollFooter } from '../ui/LoadOnScrollFooter';
import { Spinner } from '../ui/Spinner';
import { 
  parseApiResponse, 
  safeJsonParse,
  fetchBreakdownData,
  citationExportRows,
  CITATION_EXPORT_COLUMNS,
} from '../../exporters/citationParser';
import type {
  ContentTypeFilter, SortColumn, SortConfig, UrlBreakdown
} from '../../exporters/citationParser';
import { exportToExcel } from '../../exporters/excelGenerator';
import { datedExcelFileName } from '../../exporters/excelFileName';
import { fetchAllCitationUrls } from '../../api/citationPages';
import {
  useCitationPages, type CitationPages
} from './useCitationPages';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useSelectedMarketId } from '../Markets/marketSelectionContext';
import { ErrorAlert } from '../ui/ErrorAlert';

/** How long the URL search waits for typing to pause before asking the API. */
export const URL_SEARCH_DEBOUNCE_MS = 300;

interface CitationsViewProps {
  /** Rows to show until the first page arrives (the dashboard's first page), when every market is shown. */
  placeholder?: readonly TopUrl[];
  onNavigateToRawResponses?: (path: string) => void;
}

/** The stat cards: totals over the whole scope, whatever the filters. */
function summaryCards(totals: CitationsPage | null): ReadonlyArray<readonly [string, string]> {
  const urls = totals?.total_urls ?? 0;
  const citations = totals?.total_citation_count ?? 0;
  return [
    ['Total URLs', urls.toLocaleString()],
    ['Citations', citations.toLocaleString()],
    ['Citations per URL', urls > 0 ? (citations / urls).toFixed(1) : '0'],
  ];
}

function nextSort(previous: SortConfig, column: SortColumn): SortConfig {
  if (previous.column !== column) return {
    column,
    direction: 'desc',
  };
  return {
    column,
    direction: previous.direction === 'desc' ? 'asc' : 'desc',
  };
}

/** The rows to show: the placeholder until the first page of every market combined arrives, then every loaded page. */
function visibleRows(view: CitationPages, marketId: string | null, placeholder?: readonly TopUrl[]): readonly TopUrl[] {
  if (view.totals === null && marketId === null && placeholder !== undefined) return placeholder;
  return view.rows;
}

/** "Showing 50 of 1,234 URLs · more load as you scroll". */
function shownSummary(shown: number, total: number): string {
  const noun = total === 1 ? 'URL' : 'URLs';
  if (shown >= total) return `Showing ${total.toLocaleString()} ${noun}`;
  return `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} ${noun} · more load as you scroll`;
}

function isFiltered(searchQuery: string, minCitations: number | '', contentType: ContentTypeFilter): boolean {
  return searchQuery !== '' || minCitations !== '' || contentType !== 'all';
}

/**
 * Below the table: the empty state, or the end of the list that loads the
 * next page as the reader nears it. Nothing while a new order or filter
 * loads (the rows on screen are the old query's) or over placeholder rows.
 */
const CitationListEnd = ({
  view, shown, total, filtered
}: {
  view: CitationPages;
  shown: number;
  total: number;
  filtered: boolean;
}) => {
  if (view.loading) return null;
  if (shown === 0) return (
    <div className="text-center py-12 text-gray-500">
      {filtered ? 'No citations match your filters' : 'No citations yet'}
    </div>
  );
  if (view.totals === null) return null;
  return (
    <LoadOnScrollFooter
      onLoadMore={view.loadMore}
      hasMore={view.hasMore}
      loading={view.loadingMore}
      failed={view.failed}
      watch={shown}
      doneLabel={total === 1 ? 'The only URL is shown.' : `All ${total.toLocaleString()} URLs are shown.`}
    />
  );
};

export const CitationsView = ({
  placeholder, onNavigateToRawResponses 
}: CitationsViewProps) => {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [breakdownData, setBreakdownData] = useState<Record<string, UrlBreakdown[]>>({});
  const [loadingBreakdown, setLoadingBreakdown] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [minCitations, setMinCitations] = useState<number | ''>('');
  const [contentType, setContentType] = useState<ContentTypeFilter>('all');
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<CrawledContent | null>(null);
  const [loadingCitation, setLoadingCitation] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortConfig>({
    column: 'citations',
    direction: 'desc' 
  });
  const marketId = useSelectedMarketId();
  const urlContains = useDebouncedValue(searchQuery, URL_SEARCH_DEBOUNCE_MS);
  const listQuery = {
    sort: sortBy,
    urlContains,
    minCitations,
    contentType,
  };
  const view = useCitationPages(listQuery);
  const rows = visibleRows(view, marketId, placeholder);
  const totalItems = view.totals?.matched_urls ?? rows.length;

  // A new order or filter lists other URLs from the top: no row stays open.
  const handleSort = (column: SortColumn) => {
    setSortBy(prev => nextSort(prev, column));
    setExpandedRow(null);
  };

  const toggleRow = async (idx: number, url: string) => {
    if (expandedRow === idx) {
      setExpandedRow(null);
      return;
    }
    setExpandedRow(idx);
    if (breakdownData[url]) {
      return;
    }
    
    setLoadingBreakdown(prev => ({
      ...prev,
      [url]: true,
    }));
    
    const breakdown = await fetchBreakdownData(url);
    
    setBreakdownData(prev => ({
      ...prev,
      [url]: breakdown,
    }));
    setLoadingBreakdown(prev => ({
      ...prev,
      [url]: false,
    }));
  };

  const handleViewDetails = async (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLoadingCitation(true);
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/crawled-content?url=${encodeURIComponent(url)}`);
      const data = await safeJsonParse(response);
      const parsed = parseApiResponse<CrawledContent>(data);
      if (parsed.items && parsed.items.length > 0) {
        setSelectedCitation(parsed.items[0]);
      }
    } catch (err) {
      console.error('Error fetching crawled content:', err);
    } finally {
      setLoadingCitation(false);
    }
  };

  const downloadToExcel = async () => {
    setExportError(null);
    try {
      const everyUrl = await fetchAllCitationUrls({
        ...listQuery,
        urlContains: searchQuery,
        marketId,
      }, { includeKeywords: true });
      await exportToExcel({
        data: citationExportRows(everyUrl),
        columns: CITATION_EXPORT_COLUMNS,
        sheetName: 'Citations',
        fileName: datedExcelFileName('citations', new Date()),
      });
    } catch (err) {
      console.error('Error exporting citations:', err);
      setExportError('The citations could not be exported. Please try again.');
    }
  };

  const hasFilters = isFiltered(searchQuery, minCitations, contentType);

  return (
    <>
      <div className="space-y-6" aria-busy={view.loading}>
        {/* Header with explanation */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Citations</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            Every URL that ChatGPT, Perplexity, Gemini, Claude and the other engines cited in their answers for your
            keywords. Pages cited for many keywords are the sources most worth getting your brand onto.
          </p>
          <p className="mt-2 text-xs sm:text-sm text-gray-500">
            Open a row to see which keywords and engines cite it. <span className="font-medium text-gray-700">View</span> shows the crawled page.
          </p>
        </div>

        <ErrorAlert message={view.error ?? exportError} />

        {view.totals?.truncated === true && (
          <output className="block text-sm text-amber-700">
            This scope has more citations than one request can read: the totals and the list cover part of it. Narrow the scope to a keyword group or market for complete figures.
          </output>
        )}

        <CitationsAsOf totals={view.totals} />

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {summaryCards(view.totals).map(([label, value]) => (
            <div key={label} className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
              <div className="text-xs sm:text-sm text-gray-500">{label}</div>
              <div className="text-lg sm:text-2xl font-semibold text-gray-900">{value}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <CitationFilters
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          minCitations={minCitations}
          setMinCitations={setMinCitations}
          contentType={contentType}
          setContentType={setContentType}
          onFilterChange={() => setExpandedRow(null)}
          onDownloadExcel={downloadToExcel}
        />

        {/* Table */}
        <div className="bg-white rounded-lg border border-gray-200">
          <p className="px-6 py-3 text-sm text-gray-500 border-b border-gray-200">
            {shownSummary(rows.length, totalItems)}
          </p>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <CitationTableHeader sort={sortBy} onSort={handleSort} />
              <tbody className="bg-white divide-y divide-gray-200">
                {rows.map((citation, idx) => {
                  const globalRank = idx + 1;
                  const isExpanded = expandedRow === idx;
                  const breakdown = breakdownData[citation.url] ?? [];
                  const isLoading = loadingBreakdown[citation.url] ?? false;
                
                  return (
                    <CitationRow
                      key={citation.url}
                      citation={citation}
                      idx={idx}
                      globalRank={globalRank}
                      isExpanded={isExpanded}
                      breakdown={breakdown}
                      isLoading={isLoading}
                      onToggleRow={toggleRow}
                      onViewDetails={handleViewDetails}
                      onKeywordClick={setSelectedKeyword}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          <CitationListEnd view={view} shown={rows.length} total={totalItems} filtered={hasFilters} />
        </div>

      </div>

      {/* Modals - outside space-y-6 to avoid margin */}
      {selectedKeyword && (
        <KeywordDetail 
          keyword={selectedKeyword} 
          onClose={() => setSelectedKeyword(null)} 
          onNavigateToRawResponses={onNavigateToRawResponses}
        />
      )}
      
      {selectedCitation && (
        <CitationDetailModal
          citation={selectedCitation}
          onClose={() => setSelectedCitation(null)}
        />
      )}
      
      {loadingCitation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 flex items-center gap-3">
            <Spinner size="sm" className="text-gray-600" />
            <span className="text-gray-600">Loading content...</span>
          </div>
        </div>
      )}
    </>
  );
};
