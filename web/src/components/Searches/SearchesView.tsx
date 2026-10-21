import {
  useState, useMemo 
} from 'react';
import type { Search } from '../../types';
import { KeywordDetail } from '../Keywords/KeywordDetail';
import {
  PaginationHeader, type PaginationHeaderProps
} from '../ui/PaginationHeader';
import { paginate } from '../ui/pagination';
import { summarizeSearches } from '../../formatting/searchSummary';
import { exportToExcel } from '../../exporters/excelGenerator';
import {
  SEARCH_EXCEL_COLUMNS, searchExcelRows
} from '../../exporters/searchResultExporter';
import { fetchAllSearches } from '../../api/searchPages';
import { ErrorAlert } from '../ui/ErrorAlert';
import { useSearchPages } from './useSearchPages';
import {
  KeywordGroup,
  getUniqueProviders,
  groupSearchesByKeyword,
  StatsCards,
  FiltersSection,
  KeywordRow,
} from './SearchesViewComponents';

interface SearchesViewProps {
  /** The newest page of runs (the dashboard load). */
  searches: Search[];
  /** The token of the page after `searches`; `null` (the default) when there is none. */
  nextToken?: string | null;
  onNavigateToRawResponses?: (path: string) => void;
}

export const SearchesView = ({
  searches: firstPage, nextToken = null, onNavigateToRawResponses 
}: SearchesViewProps) => {
  const pages = useSearchPages(firstPage, nextToken);
  const { searches } = pages;
  const [exportError, setExportError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [promptFilter, setPromptFilter] = useState<string>('all');

  const providers = useMemo(() => getUniqueProviders(searches), [searches]);
  
  // Extract unique prompt names from searches for the filter dropdown
  const promptNames = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of searches) {
      const id = s.query_prompt_id ?? 'default';
      const name = s.query_prompt_name ?? 'Default';
      if (!seen.has(id)) seen.set(id, name);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({
      id,
      name 
    }));
  }, [searches]);

  const keywordGroups = useMemo(
    () => groupSearchesByKeyword(searches, providerFilter, searchQuery, promptFilter),
    [searches, searchQuery, providerFilter, promptFilter]
  );

  const totalSearches = searches.length;
  const totalCitations = useMemo(() => summarizeSearches(searches).totalCitations, [searches]);

  const toggleRow = (keyword: string) => {
    setExpandedRow(expandedRow === keyword ? null : keyword);
  };

  const downloadToExcel = async () => {
    setExportError(null);
    try {
      const excelData = buildExcelData(await fetchAllSearches());
      await exportToExcel({
        data: excelData,
        columns: SEARCH_EXCEL_COLUMNS,
        sheetName: 'Searches',
        fileName: `searches-${new Date().toISOString().split('T')[0]}.xlsx`,
      });
    } catch (err) {
      console.error('[searches] Error exporting searches:', err);
      setExportError('The searches could not be exported. Please try again.');
    }
  };

  const {
    pageItems: paginatedKeywords, totalItems
  } = paginate(keywordGroups, currentPage, itemsPerPage);

  const handleItemsPerPageChange = (value: number) => {
    setItemsPerPage(value);
    setCurrentPage(1);
    setExpandedRow(null);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setProviderFilter('all');
    setPromptFilter('all');
    setCurrentPage(1);
  };

  return (
    <>
      <div className="space-y-6">
        <ErrorAlert message={pages.error ?? exportError} />
        <StatsCards
          totalSearches={totalSearches}
          keywordCount={keywordGroups.length}
          totalCitations={totalCitations}
        />

        <FiltersSection
          searchQuery={searchQuery}
          setSearchQuery={(value) => { setSearchQuery(value); setCurrentPage(1); }}
          providerFilter={providerFilter}
          setProviderFilter={(value) => { setProviderFilter(value); setCurrentPage(1); }}
          promptFilter={promptFilter}
          setPromptFilter={(value) => { setPromptFilter(value); setCurrentPage(1); }}
          providers={providers}
          promptNames={promptNames}
          onClear={clearFilters}
          onExport={downloadToExcel}
        />

        <SearchTable
          keywordGroups={paginatedKeywords}
          expandedRow={expandedRow}
          onToggleRow={toggleRow}
          onSelectKeyword={setSelectedKeyword}
          pagination={{
            page: currentPage,
            pageSize: itemsPerPage,
            total: totalItems,
            onPageChange: setCurrentPage,
            onPageSizeChange: handleItemsPerPageChange,
            idPrefix: 'searches',
            label: 'Searches pagination',
          }}
          searchQuery={searchQuery}
          providerFilter={providerFilter}
        />

        {pages.hasMore && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void pages.loadMore()}
              disabled={pages.loadingMore}
              className="px-4 py-2 bg-gray-100 text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {pages.loadingMore ? 'Loading…' : 'Load older searches'}
            </button>
          </div>
        )}
      </div>


      {selectedKeyword && (
        <KeywordDetail
          keyword={selectedKeyword}
          onClose={() => setSelectedKeyword(null)}
          onNavigateToRawResponses={onNavigateToRawResponses}
        />
      )}
    </>
  );
};

function buildExcelData(searches: Search[]): Record<string, unknown>[] {
  return searches.flatMap(searchExcelRows);
}

interface SearchTableProps {
  keywordGroups: KeywordGroup[];
  expandedRow: string | null;
  onToggleRow: (keyword: string) => void;
  onSelectKeyword: (keyword: string) => void;
  pagination: PaginationHeaderProps;
  searchQuery: string;
  providerFilter: string;
}

const SearchTable = ({
  keywordGroups,
  expandedRow,
  onToggleRow,
  onSelectKeyword,
  pagination,
  searchQuery,
  providerFilter,
}: SearchTableProps) => (
  <div className="bg-white rounded-lg border border-gray-200">
    <PaginationHeader {...pagination} />

    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <TableHeader />
        <tbody className="bg-white divide-y divide-gray-200">
          {keywordGroups.map((group) => (
            <KeywordRow
              key={group.keyword}
              group={group}
              isExpanded={expandedRow === group.keyword}
              onToggle={() => onToggleRow(group.keyword)}
              onSelect={() => onSelectKeyword(group.keyword)}
            />
          ))}
        </tbody>
      </table>
    </div>

    {keywordGroups.length === 0 && (
      <EmptyState searchQuery={searchQuery} providerFilter={providerFilter} />
    )}
  </div>
);

const TableHeader = () => (
  <thead className="bg-gray-50">
    <tr>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Keyword</th>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Providers</th>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Runs</th>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Citations</th>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg</th>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Run</th>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
    </tr>
  </thead>
);

interface EmptyStateProps {
  searchQuery: string;
  providerFilter: string;
}

const EmptyState = ({
  searchQuery, providerFilter 
}: EmptyStateProps) => (
  <div className="text-center py-12 text-gray-500">
    {searchQuery || providerFilter !== 'all'
      ? 'No searches match your filters'
      : 'No searches yet'}
  </div>
);
