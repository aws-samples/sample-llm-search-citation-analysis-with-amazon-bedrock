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
import { PaginationHeader } from '../ui/PaginationHeader';
import { Spinner } from '../ui/Spinner';
import { pageWindow } from '../ui/pagination';
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
import { fetchAllCitationUrls } from '../../api/citationPages';
import {
  useMarketCitations, type MarketCitations
} from '../../hooks/useMarketCitations';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useSelectedMarketId } from '../Markets/marketSelectionContext';
import { ErrorAlert } from '../ui/ErrorAlert';
import { StrokeIcon } from '../ui/StrokeIcon';

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
    ['Avg/URL', urls > 0 ? (citations / urls).toFixed(1) : '0'],
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

/** The rows to show: the placeholder until the first page of every market combined arrives, then the page. */
function visibleRows(view: MarketCitations, marketId: string | null, placeholder?: readonly TopUrl[]): TopUrl[] {
  if (view.totals === null && marketId === null && placeholder !== undefined) return [...placeholder];
  return view.citations;
}

function isFiltered(searchQuery: string, minCitations: number | '', contentType: ContentTypeFilter): boolean {
  return searchQuery !== '' || minCitations !== '' || contentType !== 'all';
}

export const CitationsView = ({
  placeholder, onNavigateToRawResponses 
}: CitationsViewProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
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
  const view = useMarketCitations({
    ...listQuery,
    page: currentPage,
    pageSize: itemsPerPage,
  });
  const pageCitations = visibleRows(view, marketId, placeholder);
  const totalItems = view.totals?.matched_urls ?? pageCitations.length;
  const { startIndex } = pageWindow(totalItems, currentPage, itemsPerPage);

  const handleSort = (column: SortColumn) => {
    setSortBy(prev => nextSort(prev, column));
    setCurrentPage(1);
  };

  const handleItemsPerPageChange = (value: number) => {
    setItemsPerPage(value);
    setCurrentPage(1);
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
        fileName: `citations-${new Date().toISOString().split('T')[0]}.xlsx`,
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
            Browse all URLs that AI search engines cite as authoritative sources in their responses. 
            These are the websites that AI assistants like ChatGPT, Perplexity, Gemini, and Claude 
            consider trustworthy for your tracked keywords. URLs with high citation counts across 
            multiple keywords are particularly influential — getting mentioned on these sites can 
            significantly boost your AI visibility.
          </p>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs sm:text-sm">
              <StrokeIcon className="w-3.5 h-3.5" paths={['M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122']} strokeWidth={2} />
              <span className="hidden sm:inline">Click any row to see keyword and provider breakdown</span>
              <span className="sm:hidden">Tap row for details</span>
            </span>
          </div>
        </div>

        <ErrorAlert message={view.error ?? exportError} />

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
          setCurrentPage={setCurrentPage}
          onDownloadExcel={downloadToExcel}
        />

        {/* Table */}
        <div className="bg-white rounded-lg border border-gray-200">
          <PaginationHeader
            page={currentPage}
            pageSize={itemsPerPage}
            total={totalItems}
            onPageChange={setCurrentPage}
            onPageSizeChange={handleItemsPerPageChange}
            idPrefix="citations"
            label="Citations pagination"
          />

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <CitationTableHeader sort={sortBy} onSort={handleSort} />
              <tbody className="bg-white divide-y divide-gray-200">
                {pageCitations.map((citation, idx) => {
                  const globalRank = startIndex + idx + 1;
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

          {pageCitations.length === 0 && !view.loading && (
            <div className="text-center py-12 text-gray-500">
              {hasFilters ? 'No citations match your filters' : 'No citations yet'}
            </div>
          )}
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
