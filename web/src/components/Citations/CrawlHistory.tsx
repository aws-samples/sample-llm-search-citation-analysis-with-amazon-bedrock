import { formatDate } from '../../formatting/dateFormatter';
import { Spinner } from '../ui/Spinner';
import { ClockIcon } from '../ui';
import {
  BLOCK_REASON_LABELS, BlockedPageBanner, isBlockReason 
} from './BlockedPageBanner';
import type { CrawlStatus } from './BlockedPageBanner';

export interface HistoryCrawl {
  crawled_at: string;
  status?: CrawlStatus;
  block_reason?: string;
  screenshot_url?: string;
  title: string;
  summary: string;
  page_load_time_ms?: number;
  content_length?: number;
}

const HistoryItem = ({ 
  crawl, 
  isSelected, 
  onSelect 
}: { 
  crawl: HistoryCrawl; 
  isSelected: boolean; 
  onSelect: () => void;
}) => {
  const statusColors = {
    success: 'bg-emerald-100 text-emerald-800',
    blocked: 'bg-amber-100 text-amber-800',
    error: 'bg-red-100 text-red-800',
  };
  
  const status = crawl.status ?? 'success';
  const blockReason = isBlockReason(crawl.block_reason) ? crawl.block_reason : undefined;
  
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-lg border transition-colors ${
        isSelected 
          ? 'border-blue-500 bg-blue-50' 
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-900">
          {formatDate(crawl.crawled_at)}
        </span>
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusColors[status]}`}>
          {status === 'blocked' && 'Blocked'}
          {status === 'error' && 'Error'}
          {status === 'success' && 'Success'}
        </span>
      </div>
      {blockReason && (
        <p className="text-xs text-amber-600 mb-1">
          {BLOCK_REASON_LABELS[blockReason]}
        </p>
      )}
      <p className="text-xs text-gray-500 line-clamp-2">
        {crawl.summary || 'No summary available'}
      </p>
    </button>
  );
};

const HistoryScreenshot = ({ crawl }: { crawl: HistoryCrawl }) => {
  const blockReason = isBlockReason(crawl.block_reason) ? crawl.block_reason : undefined;
  
  return (
    <div className="space-y-4">
      {crawl.status === 'blocked' && (
        <BlockedPageBanner blockReason={blockReason} />
      )}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-600">
            Crawled on {formatDate(crawl.crawled_at)}
          </p>
          <div className="flex gap-4 text-xs text-gray-500">
            {crawl.page_load_time_ms && (
              <span>Load: {crawl.page_load_time_ms}ms</span>
            )}
            {crawl.content_length && (
              <span>Size: {(crawl.content_length / 1000).toFixed(1)}KB</span>
            )}
          </div>
        </div>
        {crawl.screenshot_url ? (
          <img
            src={crawl.screenshot_url}
            alt={`Screenshot from ${formatDate(crawl.crawled_at)}`}
            className="w-full border border-gray-300 rounded shadow-lg dark:brightness-90 dark:contrast-95"
          />
        ) : (
          <div className="flex items-center justify-center h-48 bg-gray-100 rounded border border-gray-200">
            <p className="text-gray-500 text-sm">No screenshot available</p>
          </div>
        )}
      </div>
    </div>
  );
};

interface HistoryTabProps {
  history: HistoryCrawl[];
  historyLoading: boolean;
  historyError: string | null;
  selectedHistoryIndex: number;
  onSelectHistory: (index: number) => void;
  onRetry: () => void;
}

export const HistoryTab = ({
  history,
  historyLoading,
  historyError,
  selectedHistoryIndex,
  onSelectHistory,
  onRetry,
}: HistoryTabProps) => {
  if (historyLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 text-gray-500">
          {/* size="md" is 4px larger than the previous inline h-5 artwork */}
          <Spinner size="md" />
          <span>Loading crawl history...</span>
        </div>
      </div>
    );
  }

  if (historyError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
        <p className="text-red-700">{historyError}</p>
        <button
          onClick={onRetry}
          className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <ClockIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
        <p>No crawl history available</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          Previous Crawls ({history.length})
        </h3>
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
          {history.map((crawl, idx) => (
            <HistoryItem
              key={crawl.crawled_at}
              crawl={crawl}
              isSelected={idx === selectedHistoryIndex}
              onSelect={() => onSelectHistory(idx)}
            />
          ))}
        </div>
      </div>
      <div className="lg:col-span-2">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Screenshot</h3>
        {history[selectedHistoryIndex] && (
          <HistoryScreenshot crawl={history[selectedHistoryIndex]} />
        )}
      </div>
    </div>
  );
};
