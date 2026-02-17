import {
  useState, useEffect, useCallback 
} from 'react';
import { formatDate } from '../../formatting/dateFormatter';
import { fetchCrawlHistory } from '../../api/dashboard';
import {
  HistoryTab, type HistoryCrawl 
} from './CrawlHistory';

interface SEOAnalysis {
  relevance_score?: number;
  keyword_usage?: string;
  strengths?: string[];
  weaknesses?: string[];
  recommendations?: string[];
  competitive_advantage?: string;
}

type CrawlStatus = 'success' | 'blocked' | 'error';
type BlockReason = 'captcha' | 'access_denied' | 'rate_limited' | 'geo_blocked' | 'login_required';

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
  page_load_time_ms?: number;
  content_length?: number;
  status?: CrawlStatus;
  block_reason?: BlockReason;
  error_message?: string;
}

interface CitationDetailModalProps {
  citation: CrawledContent;
  onClose: () => void;
}

type TabType = 'overview' | 'screenshot' | 'seo' | 'content' | 'history';

const BLOCK_REASON_LABELS: Record<BlockReason, string> = {
  captcha: 'CAPTCHA verification required',
  access_denied: 'Access denied (403 Forbidden)',
  rate_limited: 'Rate limited - too many requests',
  geo_blocked: 'Region-restricted content',
  login_required: 'Login required to access content',
};

const BlockedPageBanner = ({ blockReason }: { blockReason?: BlockReason }) => (
  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
    <div className="flex items-start gap-3">
      <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
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

const StatusBadge = ({ status }: { status?: CrawlStatus }) => {
  if (!status || status === 'success') return null;
  const styles = {
    blocked: 'bg-amber-100 text-amber-800 border-amber-200',
    error: 'bg-red-100 text-red-800 border-red-200',
  };
  const labels = {
    blocked: 'Blocked',
    error: 'Error' 
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};

const TabButton = ({
  active, onClick, icon, children 
}: { 
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode; 
}) => (
  <button
    onClick={onClick}
    className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
      active ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
    }`}
  >
    {icon}
    {children}
  </button>
);

const MetricsGrid = ({ citation }: { citation: CrawledContent }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="text-xs text-gray-600">Load Time</div>
      <div className="text-lg font-bold text-gray-900">{citation.page_load_time_ms ? `${citation.page_load_time_ms}ms` : 'N/A'}</div>
    </div>
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="text-xs text-gray-600">Content Size</div>
      <div className="text-lg font-bold text-gray-900">{citation.content_length ? `${(citation.content_length / 1000).toFixed(1)}KB` : 'N/A'}</div>
    </div>
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="text-xs text-gray-600">Citations</div>
      <div className="text-lg font-bold text-gray-900">{citation.citation_count}</div>
    </div>
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="text-xs text-gray-600">Providers</div>
      <div className="text-lg font-bold text-gray-900">{citation.citing_providers.length}</div>
    </div>
  </div>
);

const CitingProviders = ({ providers }: { providers: string[] }) => (
  <div>
    <h3 className="text-sm font-semibold text-gray-900 mb-3">Cited By</h3>
    <div className="flex gap-2 flex-wrap">
      {providers.map((provider) => (
        <span key={provider} className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
          {provider.toUpperCase()}
        </span>
      ))}
    </div>
  </div>
);

const SEOTab = ({ seoAnalysis }: { seoAnalysis: SEOAnalysis }) => (
  <div className="space-y-6">
    {seoAnalysis.relevance_score && (
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Relevance Score</h3>
            <p className="text-sm text-gray-600 mt-1">{seoAnalysis.keyword_usage}</p>
          </div>
          <div className="text-5xl font-bold text-blue-600">{seoAnalysis.relevance_score}/10</div>
        </div>
      </div>
    )}
    {seoAnalysis.strengths && seoAnalysis.strengths.length > 0 && (
      <div>
        <h3 className="text-sm font-semibold text-emerald-800 mb-3">Strengths</h3>
        <ul className="space-y-2">
          {seoAnalysis.strengths.map((s) => (
            <li key={s} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="text-emerald-600 mt-0.5">•</span><span>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    )}
    {seoAnalysis.weaknesses && seoAnalysis.weaknesses.length > 0 && (
      <div>
        <h3 className="text-sm font-semibold text-red-800 mb-3">Weaknesses</h3>
        <ul className="space-y-2">
          {seoAnalysis.weaknesses.map((w) => (
            <li key={w} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="text-red-600 mt-0.5">•</span><span>{w}</span>
            </li>
          ))}
        </ul>
      </div>
    )}
    {seoAnalysis.recommendations && seoAnalysis.recommendations.length > 0 && (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-amber-900 mb-3">Action Items</h3>
        <ol className="space-y-2">
          {seoAnalysis.recommendations.map((rec, idx) => (
            <li key={rec} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="font-bold text-yellow-700">{idx + 1}.</span><span>{rec}</span>
            </li>
          ))}
        </ol>
      </div>
    )}
    {seoAnalysis.competitive_advantage && (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Competitive Advantage</h3>
        <p className="text-sm text-gray-700">{seoAnalysis.competitive_advantage}</p>
      </div>
    )}
  </div>
);

const TabNavigation = ({
  activeTab, setActiveTab, citation 
}: { 
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  citation: CrawledContent; 
}) => (
  <div className="border-b border-gray-200 px-6">
    <nav className="-mb-px flex space-x-8">
      <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}
        icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>}>Overview</TabButton>
      {citation.screenshot_url && (
        <TabButton active={activeTab === 'screenshot'} onClick={() => setActiveTab('screenshot')}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>}>Screenshot</TabButton>
      )}
      {citation.seo_analysis && (
        <TabButton active={activeTab === 'seo'} onClick={() => setActiveTab('seo')}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>}>SEO Analysis</TabButton>
      )}
      <TabButton active={activeTab === 'content'} onClick={() => setActiveTab('content')}
        icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>}>Full Content</TabButton>
      <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')}
        icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>}>History</TabButton>
    </nav>
  </div>
);

export const CitationDetailModal = ({
  citation, onClose 
}: CitationDetailModalProps) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [history, setHistory] = useState<HistoryCrawl[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(0);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const items = await fetchCrawlHistory(citation.normalized_url, 20);
      setHistory(items);
      setSelectedHistoryIndex(0);
    } catch (err) {
      setHistoryError('Failed to load crawl history');
      console.error('Error loading history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [citation.normalized_url]);

  useEffect(() => {
    if (activeTab === 'history' && history.length === 0 && !historyLoading) {
      loadHistory();
    }
  }, [activeTab, history.length, historyLoading, loadHistory]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className="space-y-6">
            {citation.status === 'blocked' && <BlockedPageBanner blockReason={citation.block_reason} />}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Summary</h3>
              <p className="text-sm text-gray-700">
                {citation.summary || (citation.status === 'blocked' ? 'Content unavailable - page blocked by bot detection' : 'No summary available')}
              </p>
            </div>
            <MetricsGrid citation={citation} />
            <CitingProviders providers={citation.citing_providers} />
          </div>
        );
      case 'screenshot':
        return citation.screenshot_url ? (
          <div className="space-y-4">
            {citation.status === 'blocked' && <BlockedPageBanner blockReason={citation.block_reason} />}
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-4">Screenshot captured on {formatDate(citation.crawled_at)}</p>
              <img src={citation.screenshot_url} alt={`Screenshot of ${citation.title}`} className="w-full border border-gray-300 rounded shadow-lg" />
            </div>
          </div>
        ) : null;
      case 'seo':
        return citation.seo_analysis ? <SEOTab seoAnalysis={citation.seo_analysis} /> : null;
      case 'content':
        return (
          <div className="bg-gray-50 rounded-lg p-4">
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">{citation.content}</pre>
          </div>
        );
      case 'history':
        return (
          <HistoryTab
            history={history}
            historyLoading={historyLoading}
            historyError={historyError}
            selectedHistoryIndex={selectedHistoryIndex}
            onSelectHistory={setSelectedHistoryIndex}
            onRetry={loadHistory}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 !mt-0">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-start">
            <div className="flex-1 pr-4">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold text-gray-900">{citation.title}</h2>
                <StatusBadge status={citation.status} />
              </div>
              <a href={citation.normalized_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline break-all">
                {citation.normalized_url}
              </a>
              <div className="flex gap-4 mt-2 text-sm text-gray-500">
                <span>{formatDate(citation.crawled_at)}</span>
                <span>Keyword: {citation.keyword}</span>
                <span>{citation.citation_count} citation(s)</span>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none">×</button>
          </div>
        </div>
        <TabNavigation activeTab={activeTab} setActiveTab={setActiveTab} citation={citation} />
        <div className="flex-1 overflow-y-auto p-6">{renderTabContent()}</div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
