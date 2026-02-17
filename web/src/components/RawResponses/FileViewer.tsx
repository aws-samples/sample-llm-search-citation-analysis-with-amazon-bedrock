import { useState } from 'react';
import type {
  S3Item, RawResponseContent, RawResponseDocument 
} from '../../types';
import { formatDate } from '../../formatting/dateFormatter';
import { Spinner } from '../ui/Spinner';

interface FileViewerProps {
  file: S3Item;
  content: RawResponseContent;
  onDownload: () => void;
  loading: boolean;
}

type ViewTab = 'overview' | 'raw' | 'extracted' | 'metadata';

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getProviderColor = (provider: string): string => {
  const colors: Record<string, string> = {
    openai: 'bg-green-100 text-green-800',
    perplexity: 'bg-blue-100 text-blue-800',
    gemini: 'bg-purple-100 text-purple-800',
    claude: 'bg-orange-100 text-orange-800',
  };
  return colors[provider?.toLowerCase()] ?? 'bg-gray-100 text-gray-800';
};

const hasDocumentContent = (
  content: RawResponseContent
): content is RawResponseContent & { content: RawResponseDocument } => {
  if (!content.is_json) return false;
  const { content: contentValue } = content;
  // Check if content is an object with required properties
  if (!contentValue || typeof contentValue === 'string') return false;
  const doc = contentValue;
  return typeof doc.provider === 'string' && typeof doc.keyword === 'string';
};

export const FileViewer = ({
  file, content, onDownload, loading 
}: FileViewerProps) => {
  const [activeTab, setActiveTab] = useState<ViewTab>('overview');

  const doc: RawResponseDocument | null = hasDocumentContent(content)
    ? content.content
    : null;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" className="text-blue-600" />
        <span className="ml-3 text-gray-600">Loading file...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FileHeader
        file={file}
        content={content}
        onCopy={() => copyToClipboard(JSON.stringify(content.content, null, 2))}
        onDownload={onDownload}
      />

      {doc && (
        <>
          <QuickInfoCards doc={doc} />
          <TabNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
          <TabContent doc={doc} activeTab={activeTab} />
        </>
      )}

      {!doc && (
        <div className="bg-gray-900 rounded-lg p-4 max-h-[600px] overflow-auto">
          <pre className="text-sm font-mono text-gray-100">
            {content.is_json
              ? JSON.stringify(content.content, null, 2)
              : String(content.content)}
          </pre>
        </div>
      )}
    </div>
  );
};

interface FileHeaderProps {
  file: S3Item;
  content: RawResponseContent;
  onCopy: () => void;
  onDownload: () => void;
}

const FileHeader = ({
  file, content, onCopy, onDownload 
}: FileHeaderProps) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-gray-50 rounded-lg p-4 gap-3">
    <div className="min-w-0">
      <h3 className="font-medium text-gray-900 truncate">{file.name}</h3>
      <p className="text-xs sm:text-sm text-gray-500">
        {formatSize(content.size)} • {formatDate(content.last_modified)}
      </p>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={onCopy}
        className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        <span className="hidden sm:inline">Copy</span>
      </button>
      <button
        onClick={onDownload}
        className="px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <span className="hidden sm:inline">Download</span>
      </button>
    </div>
  </div>
);

interface QuickInfoCardsProps {doc: RawResponseDocument;}

const QuickInfoCards = ({ doc }: QuickInfoCardsProps) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
    <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
      <p className="text-xs sm:text-sm text-gray-500">Provider</p>
      <p
        className={`mt-1 inline-block px-2 py-1 rounded text-xs sm:text-sm font-medium ${getProviderColor(doc.provider)}`}
      >
        {doc.provider}
      </p>
    </div>
    <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
      <p className="text-xs sm:text-sm text-gray-500">Keyword</p>
      <p className="mt-1 font-medium text-gray-900 text-sm truncate" title={doc.keyword}>
        {doc.keyword}
      </p>
    </div>
    <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
      <p className="text-xs sm:text-sm text-gray-500">Timestamp</p>
      <p className="mt-1 font-medium text-gray-900 text-xs sm:text-sm">
        {formatDate(doc.timestamp)}
      </p>
    </div>
    <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
      <p className="text-xs sm:text-sm text-gray-500">Latency</p>
      <p className="mt-1 font-medium text-gray-900 text-sm">
        {doc.metadata?.latency_ms ? `${doc.metadata.latency_ms}ms` : 'N/A'}
      </p>
    </div>
  </div>
);

interface TabNavigationProps {
  activeTab: ViewTab;
  setActiveTab: (tab: ViewTab) => void;
}

const TabNavigation = ({
  activeTab, setActiveTab 
}: TabNavigationProps) => {
  const tabs: ViewTab[] = ['overview', 'raw', 'extracted', 'metadata'];

  return (
    <div className="border-b border-gray-200 overflow-x-auto">
      <nav className="-mb-px flex space-x-4 sm:space-x-8 min-w-max">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-3 px-1 border-b-2 font-medium text-xs sm:text-sm capitalize whitespace-nowrap ${
              activeTab === tab
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab === 'raw' ? (
              <>
                <span className="hidden sm:inline">Raw API </span>Response
              </>
            ) : (
              tab
            )}
          </button>
        ))}
      </nav>
    </div>
  );
};

interface TabContentProps {
  doc: RawResponseDocument;
  activeTab: ViewTab;
}

const TabContent = ({
  doc, activeTab 
}: TabContentProps) => (
  <div className="bg-white border border-gray-200 rounded-lg">
    {activeTab === 'overview' && <OverviewTab doc={doc} />}
    {activeTab === 'raw' && <JsonTab data={doc.raw_api_response} />}
    {activeTab === 'extracted' && <JsonTab data={doc.extracted} />}
    {activeTab === 'metadata' && <JsonTab data={doc.metadata} />}
  </div>
);

interface OverviewTabProps {doc: RawResponseDocument;}

const OverviewTab = ({ doc }: OverviewTabProps) => (
  <div className="p-4 space-y-4">
    <div>
      <h4 className="font-medium text-gray-900 mb-2">Response Text</h4>
      <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
        <p className="text-sm text-gray-700 whitespace-pre-wrap">
          {doc.extracted?.response_text ?? 'No response text available'}
        </p>
      </div>
    </div>

    {doc.extracted?.citations && doc.extracted.citations.length > 0 && (
      <div>
        <h4 className="font-medium text-gray-900 mb-2">
          Citations ({doc.extracted.citations.length})
        </h4>
        <div className="space-y-1">
          {doc.extracted.citations.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-blue-600 hover:underline truncate"
            >
              {url}
            </a>
          ))}
        </div>
      </div>
    )}

    {doc.extracted?.brands && doc.extracted.brands.length > 0 && (
      <div>
        <h4 className="font-medium text-gray-900 mb-2">
          Brands Extracted ({doc.extracted.brands.length})
        </h4>
        <div className="flex flex-wrap gap-2">
          {doc.extracted.brands.map((brand) => (
            <span
              key={brand.name}
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
            >
              #{brand.rank} {brand.name} ({brand.mention_count}x)
            </span>
          ))}
        </div>
      </div>
    )}
  </div>
);

interface JsonTabProps {data: unknown;}

const JsonTab = ({ data }: JsonTabProps) => (
  <div className="p-4">
    <div className="bg-gray-900 rounded-lg p-4 max-h-[600px] overflow-auto">
      <pre className="text-sm font-mono text-gray-100">{JSON.stringify(data, null, 2)}</pre>
    </div>
  </div>
);
