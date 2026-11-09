import {
  useState, useMemo, type ReactNode
} from 'react';
import type { Search } from '../../types';
import { KeywordDetail } from '../Keywords/KeywordDetail';
import { LoadOnScrollFooter } from '../ui/LoadOnScrollFooter';
import { summarizeSearches } from '../../formatting/searchSummary';
import { exportToExcel } from '../../exporters/excelGenerator';
import { datedExcelFileName } from '../../exporters/excelFileName';
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

/** Keyword rows added each time the reader reaches the end of the list. */
const SEARCH_ROWS_STEP = 25;

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
  const [visibleCount, setVisibleCount] = useState(SEARCH_ROWS_STEP);
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
        fileName: datedExcelFileName('searches', new Date()),
      });
    } catch (err) {
      console.error('[searches] Error exporting searches:', err);
      setExportError('The searches could not be exported. Please try again.');
    }
  };

  const shownKeywords = keywordGroups.slice(0, visibleCount);
  const canRevealMore = visibleCount < keywordGroups.length;
  const showFromTop = () => setVisibleCount(SEARCH_ROWS_STEP);

  // The next batch: more of the rows already loaded, else the next page from the API.
  const showMore = () => {
    if (canRevealMore) {
      setVisibleCount((count) => count + SEARCH_ROWS_STEP);
      return;
    }
    if (pages.hasMore && !pages.loadingMore) {
      setVisibleCount((count) => count + SEARCH_ROWS_STEP);
      void pages.loadMore();
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setProviderFilter('all');
    setPromptFilter('all');
    showFromTop();
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
          setSearchQuery={(value) => { setSearchQuery(value); showFromTop(); }}
          providerFilter={providerFilter}
          setProviderFilter={(value) => { setProviderFilter(value); showFromTop(); }}
          promptFilter={promptFilter}
          setPromptFilter={(value) => { setPromptFilter(value); showFromTop(); }}
          providers={providers}
          promptNames={promptNames}
          onClear={clearFilters}
          onExport={downloadToExcel}
        />

        <SearchTable
          keywordGroups={shownKeywords}
          totalKeywords={keywordGroups.length}
          moreToLoad={pages.hasMore}
          expandedRow={expandedRow}
          onToggleRow={toggleRow}
          onSelectKeyword={setSelectedKeyword}
          searchQuery={searchQuery}
          providerFilter={providerFilter}
          footer={keywordGroups.length > 0 && (
            <LoadOnScrollFooter
              onLoadMore={showMore}
              hasMore={canRevealMore || pages.hasMore}
              loading={pages.loadingMore}
              failed={pages.error !== null}
              watch={`${shownKeywords.length}/${searches.length}`}
              doneLabel={keywordGroups.length === 1 ? "The only keyword is shown." : `All ${keywordGroups.length} keywords are shown.`}
            />
          )}
        />
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
  /** Keywords matching the filters among the runs loaded so far. */
  totalKeywords: number;
  /** The API holds older runs than the ones loaded. */
  moreToLoad: boolean;
  expandedRow: string | null;
  onToggleRow: (keyword: string) => void;
  onSelectKeyword: (keyword: string) => void;
  searchQuery: string;
  providerFilter: string;
  footer: ReactNode;
}

const SearchTable = ({
  keywordGroups,
  totalKeywords,
  moreToLoad,
  expandedRow,
  onToggleRow,
  onSelectKeyword,
  searchQuery,
  providerFilter,
  footer,
}: SearchTableProps) => (
  <div className="bg-white rounded-lg border border-gray-200">
    <p className="px-6 py-3 text-sm text-gray-500 border-b border-gray-200">
      {shownSummary(keywordGroups.length, totalKeywords, moreToLoad)}
    </p>

    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <TableHeader />
        <tbody className="bg-white divide-y divide-gray-200 dark:divide-gray-700">
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
    {footer}
  </div>
);

/** "Showing 25 of 30 keywords · older runs load as you scroll". */
function shownSummary(shown: number, total: number, moreToLoad: boolean): string {
  const noun = shown === 1 ? 'keyword' : 'keywords';
  const count = shown < total ? `Showing ${shown} of ${total} keywords` : `Showing ${shown} ${noun}`;
  return moreToLoad ? `${count} · older runs load as you scroll` : `${count}, newest runs first`;
}

const TableHeader = () => (
  <thead className="bg-gray-50">
    <tr>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Keyword</th>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Providers</th>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Runs</th>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Citations</th>
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap" title="Average citations per run">Avg / run</th>
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
