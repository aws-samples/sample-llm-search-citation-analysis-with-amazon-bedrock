import type { Search } from '../../types';

export interface KeywordGroup {
  keyword: string;
  searches: Search[];
  latestTimestamp: string;
  totalRuns: number;
  totalCitations: number;
  avgCitations: number;
  providers: string[];
}

export const getUniqueProviders = (searches: Search[]): string[] => {
  const providerSet = new Set(searches.map((s) => s.provider));
  return [...providerSet].sort((a, b) => String(a).localeCompare(String(b)));
};

export const groupSearchesByKeyword = (
  searches: Search[],
  providerFilter: string,
  searchQuery: string,
  promptFilter: string = 'all'
): KeywordGroup[] => {
  const groups: Record<string, Search[]> = {};

  for (const search of searches) {
    if (providerFilter !== 'all' && search.provider !== providerFilter) continue;
    if (promptFilter !== 'all' && (search.query_prompt_id ?? 'default') !== promptFilter) continue;
    if (!groups[search.keyword]) {
      groups[search.keyword] = [];
    }
    groups[search.keyword].push(search);
  }

  return Object.entries(groups)
    .map(([keyword, keywordSearches]) => buildKeywordGroup(keyword, keywordSearches))
    .filter((g) => !searchQuery || g.keyword.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime());
};

function buildKeywordGroup(keyword: string, keywordSearches: Search[]): KeywordGroup {
  const sortedSearches = [...keywordSearches].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const latestSearch = sortedSearches[0];

  const totalCitations = keywordSearches.reduce(
    (sum, s) => sum + (s.citations?.length ?? 0),
    0
  );
  const uniqueProviders = [...new Set(keywordSearches.map((s) => s.provider))];

  return {
    keyword,
    searches: keywordSearches,
    latestTimestamp: latestSearch.timestamp,
    totalRuns: keywordSearches.length,
    totalCitations,
    avgCitations: totalCitations / keywordSearches.length,
    providers: uniqueProviders,
  };
}

interface StatsCardsProps {
  totalSearches: number;
  keywordCount: number;
  totalCitations: number;
}

export const StatsCards = ({
  totalSearches, keywordCount, totalCitations 
}: StatsCardsProps) => (
  <div className="grid grid-cols-3 gap-3 sm:gap-4">
    <StatCard label="Total Searches" value={totalSearches.toLocaleString()} />
    <StatCard label="Keywords" value={keywordCount} />
    <StatCard label="Citations" value={totalCitations.toLocaleString()} />
  </div>
);

const StatCard = ({
  label, value 
}: {
  label: string;
  value: string | number 
}) => (
  <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
    <div className="text-xs sm:text-sm text-gray-500">{label}</div>
    <div className="text-lg sm:text-2xl font-semibold text-gray-900">{value}</div>
  </div>
);

interface FiltersSectionProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  providerFilter: string;
  setProviderFilter: (value: string) => void;
  promptFilter: string;
  setPromptFilter: (value: string) => void;
  providers: string[];
  promptNames: { id: string; name: string }[];
  onClear: () => void;
  onExport: () => void;
}

export const FiltersSection = ({
  searchQuery,
  setSearchQuery,
  providerFilter,
  setProviderFilter,
  promptFilter,
  setPromptFilter,
  providers,
  promptNames,
  onClear,
  onExport,
}: FiltersSectionProps) => (
  <div className="bg-white rounded-lg border border-gray-200 p-4">
    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-end">
      <div className="flex-1">
        <label className="block text-sm font-medium text-gray-700 mb-1">Search Keyword</label>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter by keyword..."
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      </div>
      <div className="w-full sm:w-40">
        <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        >
          <option value="all">All Providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      {promptNames.length > 0 && (
        <div className="w-full sm:w-44">
          <label className="block text-sm font-medium text-gray-700 mb-1">Query Prompt</label>
          <select
            value={promptFilter}
            onChange={(e) => setPromptFilter(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            <option value="all">All Prompts</option>
            {promptNames.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={onClear}
          className="flex-1 sm:flex-none px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
        >
          Clear
        </button>
        <button
          onClick={onExport}
          className="flex-1 sm:flex-none px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 flex items-center justify-center gap-2"
        >
          <DownloadIcon />
          <span className="hidden sm:inline">Export</span>
        </button>
      </div>
    </div>
  </div>
);

const DownloadIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);

interface PaginationHeaderProps {
  totalItems: number;
  showAll: boolean;
  startIndex: number;
  endIndex: number;
  totalPages: number;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  itemsPerPage: number;
  onItemsPerPageChange: (value: number) => void;
}

export const PaginationHeader = ({
  totalItems,
  showAll,
  startIndex,
  endIndex,
  totalPages,
  currentPage,
  setCurrentPage,
  itemsPerPage,
  onItemsPerPageChange,
}: PaginationHeaderProps) => (
  <div className="p-3 sm:p-4 border-b border-gray-200">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-gray-500">Show:</span>
        <select
          value={itemsPerPage}
          onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
          className="px-2 sm:px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={-1}>All ({totalItems})</option>
        </select>
        <span className="text-gray-500 text-xs sm:text-sm">
          {showAll
            ? `All ${totalItems}`
            : `${startIndex + 1}-${Math.min(endIndex, totalItems)} of ${totalItems}`}
        </span>
      </div>
      {!showAll && totalPages > 1 && (
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          setCurrentPage={setCurrentPage}
        />
      )}
    </div>
  </div>
);

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  setCurrentPage: (page: number) => void;
}

const PaginationControls = ({
  currentPage, totalPages, setCurrentPage 
}: PaginationControlsProps) => (
  <div className="flex items-center gap-1 overflow-x-auto">
    <PageButton label="First" onClick={() => setCurrentPage(1)} disabled={currentPage === 1} />
    <PageButton label="Prev" onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} />
    <span className="px-2 sm:px-3 py-1 text-gray-700 text-xs sm:text-sm">{currentPage}/{totalPages}</span>
    <PageButton label="Next" onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} />
    <PageButton label="Last" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} />
  </div>
);

const PageButton = ({
  label, onClick, disabled 
}: {
  label: string;
  onClick: () => void;
  disabled: boolean 
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50 text-xs sm:text-sm"
  >
    {label}
  </button>
);

interface KeywordRowProps {
  group: KeywordGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}

export const KeywordRow = ({
  group, isExpanded, onToggle, onSelect 
}: KeywordRowProps) => (
  <>
    <tr className="hover:bg-gray-50">
      <td
        className="px-6 py-4 text-sm font-medium text-gray-900 hover:text-gray-600 cursor-pointer"
        onClick={onSelect}
      >
        {group.keyword}
      </td>
      <td className="px-6 py-4 text-sm">
        <div className="flex flex-wrap gap-1">
          {group.providers.map((p) => (
            <span key={p} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{p}</span>
          ))}
        </div>
      </td>
      <td className="px-6 py-4 text-sm">
        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{group.totalRuns}</span>
      </td>
      <td className="px-6 py-4 text-sm">
        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{group.totalCitations}</span>
      </td>
      <td className="px-6 py-4 text-sm text-gray-500">{group.avgCitations.toFixed(1)}</td>
      <td className="px-6 py-4 text-sm text-gray-500">{new Date(group.latestTimestamp).toLocaleString()}</td>
      <td className="px-6 py-4">
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1"
        >
          View
          <ChevronIcon isExpanded={isExpanded} />
        </button>
      </td>
    </tr>
    {isExpanded && <ExpandedRow searches={group.searches} />}
  </>
);

const ChevronIcon = ({ isExpanded }: { isExpanded: boolean }) => (
  <svg
    className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const ExpandedRow = ({ searches }: { searches: Search[] }) => (
  <tr>
    <td colSpan={7} className="px-6 py-4 bg-gray-50">
      <div className="space-y-2">
        {searches.map((search) => (
          <SearchDetailItem
            key={`${search.keyword}-${search.provider}-${search.timestamp}`}
            search={search}
          />
        ))}
      </div>
    </td>
  </tr>
);

const SearchDetailItem = ({ search }: { search: Search }) => {
  const hasCitations = search.citations && search.citations.length > 0;

  return (
    <div
      className={`flex items-center justify-between p-3 bg-white rounded-lg border ${
        hasCitations ? 'border-gray-200' : 'border-red-200'
      }`}
    >
      <div className="flex items-center gap-4">
        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">
          {search.provider}
        </span>
        <span className="text-sm text-gray-500">{new Date(search.timestamp).toLocaleString()}</span>
      </div>
      <span
        className={`px-2 py-0.5 rounded text-xs ${
          hasCitations ? 'bg-gray-100 text-gray-700' : 'bg-red-100 text-red-700'
        }`}
      >
        {search.citations?.length ?? 0} citations
      </span>
    </div>
  );
};
