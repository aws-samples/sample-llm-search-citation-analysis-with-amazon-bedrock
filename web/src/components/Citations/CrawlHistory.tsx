import { formatDate } from '../../formatting/dateFormatter';

type CrawlStatus = 'success' | 'blocked' | 'error';
type BlockReason = 'captcha' | 'access_denied' | 'rate_limited' | 'geo_blocked' | 'login_required';

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

const BLOCK_REASON_LABELS: Record<BlockReason, string> = {
  captcha: 'CAPTCHA verification required',
  access_denied: 'Access denied (403 Forbidden)',
  rate_limited: 'Rate limited - too many requests',
  geo_blocked: 'Region-restricted content',
  login_required: 'Login required to access content',
};

function isBlockReason(value: string | undefined): value is BlockReason {
  const validReasons = ['captcha', 'access_denied', 'rate_limited', 'geo_blocked', 'login_required'];
  return value !== undefined && validReasons.includes(value);
}

const BlockedPageBanner = ({ blockReason }: { blockReason?: BlockReason }) => (
  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
    <div className="flex items-start gap-3">
      <svg 
        className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" 
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={2} 
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
        />
      </svg>
      <div>
        <h4 className="text-sm font-semibold text-amber-800">Bot Detection Blocked</h4>
        <p className="text-sm text-amber-700 mt-1">
          This site blocked automated access. The screenshot shows the block page, not the actual content.
        </p>
        {blockReason && (
          <p className="text-sm text-amber-600 mt-2">
            <span className="font-medium">Reason:</span> {BLOCK_REASON_LABELS[blockReason]}
          </p>
        )}
      </div>
    </div>
  </div>
);

export const HistoryItem = ({ 
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

export const HistoryScreenshot = ({ crawl }: { crawl: HistoryCrawl }) => {
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
            className="w-full border border-gray-300 rounded shadow-lg"
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
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path 
              className="opacity-75" 
              fill="currentColor" 
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" 
            />
          </svg>
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
        <svg 
          className="w-12 h-12 mx-auto mb-4 text-gray-300" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={1.5} 
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
          />
        </svg>
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
