import {
  useState, useMemo 
} from 'react';
import type { TopUrl } from '../../types';
import { API_BASE_URL } from '../../infrastructure';
import { exportToExcel } from '../../exporters/excelGenerator';

interface TopCitationsTableProps {citations: TopUrl[];}

interface UrlBreakdown {
  keyword: string;
  provider: string;
  timestamp: string;
}

interface BreakdownResponse {breakdown?: UrlBreakdown[];}

function isBreakdownResponse(data: unknown): data is BreakdownResponse {
  return typeof data === 'object' && data !== null;
}

function BreakdownContent({
  isLoading, breakdown 
}: {
  readonly isLoading: boolean;
  readonly breakdown: UrlBreakdown[] 
}) {
  if (isLoading) {
    return (
      <div className="text-center py-4 text-gray-500">
        Loading breakdown...
      </div>
    );
  }
  
  if (breakdown.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500">
        No breakdown data available
      </div>
    );
  }

  return (
    <div className="text-sm">
      <div className="font-semibold text-gray-700 mb-3">
        Keywords & Providers ({breakdown.length} citations):
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">
                Keyword
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">
                Provider
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">
                Timestamp
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {breakdown.map((item) => (
              <tr key={`${item.keyword}-${item.provider}-${item.timestamp}`} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm text-gray-900">
                  {item.keyword}
                </td>
                <td className="px-4 py-2 text-sm">
                  <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-xs">
                    {item.provider}
                  </span>
                </td>
                <td className="px-4 py-2 text-sm text-gray-500">
                  {new Date(item.timestamp).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const TopCitationsTable = ({ citations }: TopCitationsTableProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [breakdownData, setBreakdownData] = useState<Record<string, UrlBreakdown[]>>({});
  const [loadingBreakdown, setLoadingBreakdown] = useState<Record<string, boolean>>({});

  // Sort citations by count descending
  const sortedCitations = useMemo(() => {
    return [...citations].sort((a, b) => b.citation_count - a.citation_count);
  }, [citations]);
  // Pagination logic
  const totalItems = sortedCitations.length;
  const showAll = itemsPerPage === -1;
  const totalPages = showAll ? 1 : Math.ceil(totalItems / itemsPerPage);
  const startIndex = showAll ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = showAll ? totalItems : startIndex + itemsPerPage;
  const paginatedCitations = sortedCitations.slice(startIndex, endIndex);

  // Reset to page 1 when items per page changes
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

    // Fetch breakdown if not already loaded
    if (!breakdownData[url]) {
      setLoadingBreakdown({
        ...loadingBreakdown,
        [url]: true 
      });
      try {
        const response = await fetch(`${API_BASE_URL}/url-breakdown?url=${encodeURIComponent(url)}`);
        const json: unknown = await response.json();
        const breakdown = isBreakdownResponse(json) ? (json.breakdown ?? []) : [];
        setBreakdownData({
          ...breakdownData,
          [url]: breakdown 
        });
      } catch (err) {
        console.error('Error fetching breakdown:', err);
        setBreakdownData({
          ...breakdownData,
          [url]: [] 
        });
      } finally {
        setLoadingBreakdown({
          ...loadingBreakdown,
          [url]: false 
        });
      }
    }
  };

  const downloadToExcel = async () => {
    const excelData = sortedCitations.map((citation, idx) => ({
      Rank: idx + 1,
      URL: citation.url,
      'Citation Count': citation.citation_count,
    }));
    await exportToExcel({
      data: excelData,
      columns: [{ wch: 8 }, { wch: 80 }, { wch: 15 }],
      sheetName: 'Top Cited URLs',
      fileName: `top-cited-urls-${new Date().toISOString().split('T')[0]}.xlsx`,
    });
  };

  return (
    <div className="bg-white rounded-lg shadow mb-8">
      <div className="p-4 sm:p-6 border-b border-gray-200">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">Top Cited URLs</h2>
          <button
            onClick={downloadToExcel}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">Export to Excel</span>
            <span className="sm:hidden">Export</span>
          </button>
        </div>

        {/* Pagination Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-600">Show:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
              className="px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={-1}>All ({totalItems})</option>
            </select>
            <span className="text-gray-600 text-xs sm:text-sm">
              {showAll 
                ? `All ${totalItems} URLs`
                : `${startIndex + 1}-${Math.min(endIndex, totalItems)} of ${totalItems}`
              }
            </span>
          </div>

          {!showAll && totalPages > 1 && (
            <div className="flex flex-wrap items-center gap-1 sm:gap-2">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-2 sm:px-3 py-1 text-xs sm:text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                First
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-2 sm:px-3 py-1 text-xs sm:text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <span className="px-2 sm:px-3 py-1 text-xs sm:text-sm text-gray-700">
                {currentPage}/{totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-2 sm:px-3 py-1 text-xs sm:text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-2 sm:px-3 py-1 text-xs sm:text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Last
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                URL
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Citations
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedCitations.map((citation, idx) => {
              const globalRank = startIndex + idx + 1;
              const isExpanded = expandedRow === idx;
              const breakdown = breakdownData[citation.url] ?? [];
              const isLoading = loadingBreakdown[citation.url];

              return (
                <>
                  <tr key={citation.url} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400 font-medium min-w-[2rem]">#{globalRank}</span>
                        <a
                          href={citation.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {citation.url.length > 80
                            ? citation.url.substring(0, 80) + '...'
                            : citation.url}
                        </a>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <button
                        onClick={() => toggleRow(idx, citation.url)}
                        className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full font-medium hover:bg-blue-200 cursor-pointer transition-colors"
                      >
                        {citation.citation_count} {isExpanded ? '▼' : '▶'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${citation.url}-expanded`}>
                      <td colSpan={2} className="px-6 py-4 bg-gray-50">
                        <BreakdownContent isLoading={isLoading} breakdown={breakdown} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
