import React, {
  useState,
  useMemo,
} from 'react';
import type { TopUrl } from '../../types';
import {
  API_BASE_URL, authenticatedFetch 
} from '../../infrastructure';
import { KeywordDetail } from '../Keywords/KeywordDetail';
import { CitationDetailModal } from './CitationDetailModal';
import { CitationFilters } from './CitationFilters';
import { CitationTableHeader } from './CitationTableHeader';
import { CitationRow } from './CitationRow';
import { PaginationControls } from './PaginationControls';
import { Spinner } from '../ui/Spinner';
import { 
  parseApiResponse, 
  filterAndSortCitations, 
  safeJsonParse,
  fetchBreakdownData 
} from '../../exporters/citationParser';
import { exportToExcel } from '../../exporters/excelGenerator';

interface CitationsViewProps {
  citations: TopUrl[];
  onNavigateToRawResponses?: (path: string) => void;
}

interface UrlBreakdown {
  keyword: string;
  provider: string;
  timestamp: string;
}

interface SEOAnalysis {
  relevance_score?: number;
  content_quality?: number;
  keyword_optimization?: number;
  recommendations?: string[];
  [key: string]: unknown;
}

interface CrawledContent {
  normalized_url: string;
  title: string;
  summary: string;
  content: string;
  screenshot_url?: string;
  seo_analysis?: SEOAnalysis;
  crawled_at: string;
  keyword: string;
  citation_count: number;
  citing_providers: string[];
}

export const CitationsView = ({
  citations, onNavigateToRawResponses 
}: CitationsViewProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [breakdownData, setBreakdownData] = useState<Record<string, UrlBreakdown[]>>({});
  const [loadingBreakdown, setLoadingBreakdown] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [minCitations, setMinCitations] = useState<number | ''>('');
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<CrawledContent | null>(null);
  const [loadingCitation, setLoadingCitation] = useState(false);
  const [sortBy, setSortBy] = useState<'citations' | 'keywords'>('citations');

  // Filter and sort citations
  const filteredCitations = useMemo(() => 
    filterAndSortCitations(citations, searchQuery, minCitations, sortBy),
  [citations, searchQuery, minCitations, sortBy]
  );

  const totalItems = filteredCitations.length;
  const showAll = itemsPerPage === -1;
  const totalPages = showAll ? 1 : Math.ceil(totalItems / itemsPerPage);
  const startIndex = showAll ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = showAll ? totalItems : startIndex + itemsPerPage;
  const paginatedCitations = filteredCitations.slice(startIndex, endIndex);

  // Stats
  const totalCitationCount = citations.reduce((sum, c) => sum + c.citation_count, 0);
  const avgCitations = citations.length > 0 ? (totalCitationCount / citations.length).toFixed(1) : '0';

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
    const excelData = filteredCitations.map((citation, idx) => ({
      Rank: idx + 1,
      URL: citation.url,
      Domain: getDomain(citation.url),
      Keywords: citation.keyword_count ?? 0,
      'Citation Count': citation.citation_count,
    }));
    await exportToExcel({
      data: excelData,
      columns: [{ wch: 8 }, { wch: 80 }, { wch: 30 }, { wch: 10 }, { wch: 15 }],
      sheetName: 'Citations',
      fileName: `citations-${new Date().toISOString().split('T')[0]}.xlsx`,
    });
  };

  const getDomain = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  return (
    <>
      <div className="space-y-6">
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
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
              <span className="hidden sm:inline">Click any row to see keyword and provider breakdown</span>
              <span className="sm:hidden">Tap row for details</span>
            </span>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
            <div className="text-xs sm:text-sm text-gray-500">Total URLs</div>
            <div className="text-lg sm:text-2xl font-semibold text-gray-900">{citations.length.toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
            <div className="text-xs sm:text-sm text-gray-500">Citations</div>
            <div className="text-lg sm:text-2xl font-semibold text-gray-900">{totalCitationCount.toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
            <div className="text-xs sm:text-sm text-gray-500">Avg/URL</div>
            <div className="text-lg sm:text-2xl font-semibold text-gray-900">{avgCitations}</div>
          </div>
        </div>

        {/* Filters */}
        <CitationFilters
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          minCitations={minCitations}
          setMinCitations={setMinCitations}
          setCurrentPage={setCurrentPage}
          onDownloadExcel={downloadToExcel}
        />

        {/* Table */}
        <div className="bg-white rounded-lg border border-gray-200">
          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            itemsPerPage={itemsPerPage}
            totalItems={totalItems}
            startIndex={startIndex}
            endIndex={endIndex}
            showAll={showAll}
            onPageChange={setCurrentPage}
            onItemsPerPageChange={handleItemsPerPageChange}
          />

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <CitationTableHeader sortBy={sortBy} setSortBy={setSortBy} />
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedCitations.map((citation, idx) => {
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
                      getDomain={getDomain}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          {paginatedCitations.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              {searchQuery || minCitations ? 'No citations match your filters' : 'No citations yet'}
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
