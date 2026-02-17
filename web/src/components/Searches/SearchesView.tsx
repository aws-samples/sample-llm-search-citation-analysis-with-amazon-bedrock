import {
  useState, useMemo 
} from 'react';
import type { Search } from '../../types';
import { AlertModal } from '../ui/Modal';
import { KeywordDetail } from '../Keywords/KeywordDetail';
import { exportToExcel } from '../../exporters/excelGenerator';
import {
  KeywordGroup,
  getUniqueProviders,
  groupSearchesByKeyword,
  StatsCards,
  FiltersSection,
  PaginationHeader,
  KeywordRow,
} from './SearchesViewComponents';

interface SearchesViewProps {
  searches: Search[];
  onRerunSuccess?: (executionArn: string, executionName: string) => void;
  isRunning?: boolean;
  onNavigateToRawResponses?: (path: string) => void;
}

export const SearchesView = ({
  searches, onNavigateToRawResponses 
}: SearchesViewProps) => {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [promptFilter, setPromptFilter] = useState<string>('all');

  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: 'success' | 'error' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    variant: 'info',
  });

  const providers = useMemo(() => getUniqueProviders(searches), [searches]);
  
  // Extract unique prompt names from searches for the filter dropdown
  const promptNames = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of searches) {
      const id = s.query_prompt_id ?? 'default';
      const name = s.query_prompt_name ?? 'Default';
      if (!seen.has(id)) seen.set(id, name);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [searches]);

  const keywordGroups = useMemo(
    () => groupSearchesByKeyword(searches, providerFilter, searchQuery, promptFilter),
    [searches, searchQuery, providerFilter, promptFilter]
  );

  const totalSearches = searches.length;
  const totalCitations = searches.reduce((sum, s) => sum + (s.citations?.length ?? 0), 0);

  const toggleRow = (keyword: string) => {
    setExpandedRow(expandedRow === keyword ? null : keyword);
  };

  const downloadToExcel = async () => {
    const excelData = buildExcelData(searches);
    await exportToExcel({
      data: excelData,
      columns: [{ wch: 25 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 80 }],
      sheetName: 'Searches',
      fileName: `searches-${new Date().toISOString().split('T')[0]}.xlsx`,
    });
  };

  const totalItems = keywordGroups.length;
  const showAll = itemsPerPage === -1;
  const totalPages = showAll ? 1 : Math.ceil(totalItems / itemsPerPage);
  const startIndex = showAll ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = showAll ? totalItems : startIndex + itemsPerPage;
  const paginatedKeywords = keywordGroups.slice(startIndex, endIndex);

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
          totalItems={totalItems}
          showAll={showAll}
          startIndex={startIndex}
          endIndex={endIndex}
          totalPages={totalPages}
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          itemsPerPage={itemsPerPage}
          onItemsPerPageChange={handleItemsPerPageChange}
          searchQuery={searchQuery}
          providerFilter={providerFilter}
        />
      </div>

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal({
          ...alertModal,
          isOpen: false 
        })}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />

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
  const excelData: Record<string, unknown>[] = [];

  for (const search of searches) {
    if (search.citations && search.citations.length > 0) {
      search.citations.forEach((citation, idx) => {
        excelData.push({
          Keyword: search.keyword,
          Provider: search.provider,
          Timestamp: new Date(search.timestamp).toLocaleString(),
          'Citation #': idx + 1,
          'Citation URL': citation,
        });
      });
    } else {
      excelData.push({
        Keyword: search.keyword,
        Provider: search.provider,
        Timestamp: new Date(search.timestamp).toLocaleString(),
        'Citation #': 0,
        'Citation URL': 'No citations',
      });
    }
  }

  return excelData;
}

interface SearchTableProps {
  keywordGroups: KeywordGroup[];
  expandedRow: string | null;
  onToggleRow: (keyword: string) => void;
  onSelectKeyword: (keyword: string) => void;
  totalItems: number;
  showAll: boolean;
  startIndex: number;
  endIndex: number;
  totalPages: number;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  itemsPerPage: number;
  onItemsPerPageChange: (value: number) => void;
  searchQuery: string;
  providerFilter: string;
}

const SearchTable = ({
  keywordGroups,
  expandedRow,
  onToggleRow,
  onSelectKeyword,
  totalItems,
  showAll,
  startIndex,
  endIndex,
  totalPages,
  currentPage,
  setCurrentPage,
  itemsPerPage,
  onItemsPerPageChange,
  searchQuery,
  providerFilter,
}: SearchTableProps) => (
  <div className="bg-white rounded-lg border border-gray-200">
    <PaginationHeader
      totalItems={totalItems}
      showAll={showAll}
      startIndex={startIndex}
      endIndex={endIndex}
      totalPages={totalPages}
      currentPage={currentPage}
      setCurrentPage={setCurrentPage}
      itemsPerPage={itemsPerPage}
      onItemsPerPageChange={onItemsPerPageChange}
    />

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
