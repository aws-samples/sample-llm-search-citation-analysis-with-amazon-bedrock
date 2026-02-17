import {
  useState, useMemo 
} from 'react';
import type { Search } from '../../types';
import {
  ConfirmModal, AlertModal 
} from '../ui/Modal';
import { KeywordDetail } from '../Keywords/KeywordDetail';
import { triggerKeywordAnalysis } from '../../exporters/analysisExecutor';
import { downloadSearchesToExcel } from '../../exporters/searchResultExporter';

interface RecentSearchesTableProps {
  searches: Search[];
  onRerunSuccess?: (executionArn: string, executionName: string) => void;
  isRunning?: boolean;
  onNavigateToRawResponses?: (path: string) => void;
}

export const RecentSearchesTable = ({
  searches,
  onRerunSuccess,
  isRunning,
  onNavigateToRawResponses,
}: RecentSearchesTableProps) => {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    failedCount: 0 
  });
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

  const keywordGroups = useMemo(() => {
    const groups: { [keyword: string]: Search[] } = {};
    searches.forEach((search) => {
      if (!groups[search.keyword]) groups[search.keyword] = [];
      groups[search.keyword].push(search);
    });

    return Object.entries(groups)
      .map(([keyword, keywordSearches]) => {
        const sortedSearches = [...keywordSearches].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        const totalCitations = keywordSearches.reduce((sum, s) => sum + (s.citations?.length ?? 0), 0);
        const hasFailed = keywordSearches.some((s) => !s.citations || s.citations.length === 0);

        return {
          keyword,
          searches: keywordSearches,
          latestTimestamp: sortedSearches[0].timestamp,
          totalRuns: keywordSearches.length,
          totalCitations,
          avgCitations: totalCitations / keywordSearches.length,
          hasFailed,
        };
      })
      .sort((a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime());
  }, [searches]);

  const rerunFailed = async () => {
    const failedKeywords = Array.from(
      new Set(searches.filter((s) => !s.citations || s.citations.length === 0).map((s) => s.keyword))
    );

    if (failedKeywords.length === 0) {
      setAlertModal({
        isOpen: true,
        title: 'Info',
        message: 'No failed searches to run',
        variant: 'info' 
      });
      return;
    }

    setConfirmModal({
      isOpen: true,
      failedCount: failedKeywords.length 
    });
  };

  const confirmRerunFailed = async () => {
    const failedKeywords = Array.from(
      new Set(searches.filter((s) => !s.citations || s.citations.length === 0).map((s) => s.keyword))
    );

    try {
      const data = await triggerKeywordAnalysis(failedKeywords);
      
      if (data.execution_arn && data.execution_name && onRerunSuccess) {
        onRerunSuccess(data.execution_arn, data.execution_name);
      }

      setAlertModal({
        isOpen: true,
        title: 'Success',
        message: `Running analysis for ${failedKeywords.length} keyword(s)`,
        variant: 'success',
      });
    } catch (err) {
      console.error('Error re-running failed keywords:', err);
      setAlertModal({
        isOpen: true,
        title: 'Error',
        message: 'Failed to run analysis',
        variant: 'error',
      });
    }
  };

  const failedCount = keywordGroups.filter((g) => g.hasFailed).length;
  const totalItems = keywordGroups.length;
  const showAll = itemsPerPage === -1;
  const totalPages = showAll ? 1 : Math.ceil(totalItems / itemsPerPage);
  const startIndex = showAll ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = showAll ? totalItems : startIndex + itemsPerPage;
  const paginatedKeywords = keywordGroups.slice(startIndex, endIndex);

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="p-4 sm:p-6 border-b border-gray-200">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">Recent Searches</h2>
            {failedCount > 0 && !isRunning && (
              <button
                onClick={rerunFailed}
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                Retry Failed ({failedCount})
              </button>
            )}
          </div>
          <button
            onClick={() => downloadSearchesToExcel(keywordGroups)}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-500">Show:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
                setExpandedRow(null);
              }}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={-1}>All ({totalItems})</option>
            </select>
            <span className="text-gray-500 text-xs sm:text-sm">
              {showAll ? `All ${totalItems}` : `${startIndex + 1}-${Math.min(endIndex, totalItems)} of ${totalItems}`}
            </span>
          </div>

          {!showAll && totalPages > 1 && (
            <div className="flex flex-wrap items-center gap-1">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="px-2 py-1 text-xs sm:text-sm text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50">First</button>
              <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-2 py-1 text-xs sm:text-sm text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50">Prev</button>
              <span className="px-2 sm:px-3 py-1 text-xs sm:text-sm text-gray-700">{currentPage}/{totalPages}</span>
              <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-2 py-1 text-xs sm:text-sm text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50">Next</button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="px-2 py-1 text-xs sm:text-sm text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50">Last</button>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Keyword</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Runs</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Citations</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Run</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedKeywords.map((group) => (
              <>
                <tr key={group.keyword} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 hover:text-gray-600 cursor-pointer" onClick={() => setSelectedKeyword(group.keyword)}>{group.keyword}</td>
                  <td className="px-6 py-4 text-sm"><span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{group.totalRuns}</span></td>
                  <td className="px-6 py-4 text-sm"><span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{group.totalCitations}</span></td>
                  <td className="px-6 py-4 text-sm text-gray-500">{group.avgCitations.toFixed(1)}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{new Date(group.latestTimestamp).toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <button onClick={() => setExpandedRow(expandedRow === group.keyword ? null : group.keyword)} className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1">
                      Providers
                      <svg className={`w-3 h-3 transition-transform ${expandedRow === group.keyword ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </td>
                </tr>
                {expandedRow === group.keyword && (
                  <tr key={`${group.keyword}-exp`}>
                    <td colSpan={6} className="px-6 py-4 bg-gray-50">
                      <div className="space-y-2">
                        {group.searches.map((search) => (
                          <div key={`${search.keyword}-${search.provider}-${search.timestamp}`} className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
                            <div className="flex items-center gap-4">
                              <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">{search.provider}</span>
                              <span className="text-sm text-gray-500">{new Date(search.timestamp).toLocaleString()}</span>
                            </div>
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{search.citations?.length ?? 0} citations</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({
          ...confirmModal,
          isOpen: false 
        })}
        onConfirm={confirmRerunFailed}
        title="Run Failed Searches"
        message={`Run analysis for ${confirmModal.failedCount} failed keyword(s)?`}
        confirmText="Run Analysis"
        confirmVariant="primary"
      />

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
    </div>
  );
};