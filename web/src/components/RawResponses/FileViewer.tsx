import {
  useId, useState
} from 'react';
import type { ReactNode } from 'react';
import type {
  S3Item, RawResponseContent, RawResponseDocument 
} from '../../types';
import { formatDate } from '../../formatting/dateFormatter';
import { useClipboardCopy } from '../../hooks/useClipboardCopy';
import { safeHref } from '../../infrastructure';
import { ClipboardIcon } from '../ui/ClipboardIcon';
import { DownloadButton } from './DownloadButton';
import {
  ViewerHeader, ViewerLoading
} from './ViewerHeader';
import { formatSize } from './fileSizeFormatter';
import { providerColor } from '../../constants/providers';
import {
  TabBar, TabPanel, type TabDefinition
} from '../ui/TabBar';

interface FileViewerProps {
  file: S3Item;
  content: RawResponseContent;
  onDownload: () => void;
  loading: boolean;
}

type ViewTab = 'overview' | 'raw' | 'extracted' | 'metadata';

const VIEW_TABS: ReadonlyArray<TabDefinition<ViewTab>> = [
  {
    id: 'overview',
    label: 'Overview',
  },
  {
    id: 'raw',
    label: 'Raw API Response',
    shortLabel: 'Response',
  },
  {
    id: 'extracted',
    label: 'Extracted',
  },
  {
    id: 'metadata',
    label: 'Metadata',
  },
];

const getProviderColor = (provider: string): string =>
  providerColor(provider.toLowerCase())?.badge ?? 'bg-gray-100 text-gray-800';

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
  const panelId = useId();

  const doc: RawResponseDocument | null = hasDocumentContent(content)
    ? content.content
    : null;

  const { copy } = useClipboardCopy();

  if (loading) {
    return <ViewerLoading label="Loading file..." />;
  }

  return (
    <div className="space-y-4">
      <FileHeader
        file={file}
        content={content}
        onCopy={() => void copy(JSON.stringify(content.content, null, 2))}
        onDownload={onDownload}
      />

      {doc && (
        <>
          <QuickInfoCards doc={doc} />
          <TabBar tabs={VIEW_TABS} activeId={activeTab} onChange={setActiveTab} label="File views" panelId={panelId} />
          <TabPanel id={panelId} activeId={activeTab} className="bg-white border border-gray-200 rounded-lg">
            <TabContent doc={doc} activeTab={activeTab} />
          </TabPanel>
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
  <ViewerHeader
    name={file.name}
    details={<>{formatSize(content.size)} • {formatDate(content.last_modified)}</>}
  >
    <button
      onClick={onCopy}
      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1"
    >
      <ClipboardIcon className="w-4 h-4" />
      <span className="sr-only sm:not-sr-only">Copy</span>
    </button>
    <DownloadButton onClick={onDownload} />
  </ViewerHeader>
);

interface QuickInfoCardsProps {doc: RawResponseDocument;}

const InfoCard = ({
  label, children
}: {
  label: string;
  children: ReactNode 
}) => (
  <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
    <p className="text-xs sm:text-sm text-gray-500">{label}</p>
    {children}
  </div>
);

const QuickInfoCards = ({ doc }: QuickInfoCardsProps) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
    <InfoCard label="Provider">
      <p
        className={`mt-1 inline-block px-2 py-1 rounded text-xs sm:text-sm font-medium ${getProviderColor(doc.provider)}`}
      >
        {doc.provider}
      </p>
    </InfoCard>
    <InfoCard label="Keyword">
      <p className="mt-1 font-medium text-gray-900 text-sm truncate" title={doc.keyword}>
        {doc.keyword}
      </p>
    </InfoCard>
    <InfoCard label="Timestamp">
      <p className="mt-1 font-medium text-gray-900 text-xs sm:text-sm">
        {formatDate(doc.timestamp)}
      </p>
    </InfoCard>
    <InfoCard label="Latency">
      <p className="mt-1 font-medium text-gray-900 text-sm">
        {doc.metadata?.latency_ms ? `${doc.metadata.latency_ms}ms` : 'N/A'}
      </p>
    </InfoCard>
  </div>
);

interface TabContentProps {
  doc: RawResponseDocument;
  activeTab: ViewTab;
}

const TabContent = ({
  doc, activeTab 
}: TabContentProps) => (
  <>
    {activeTab === 'overview' && <OverviewTab doc={doc} />}
    {activeTab === 'raw' && <JsonTab data={doc.raw_api_response} />}
    {activeTab === 'extracted' && <JsonTab data={doc.extracted} />}
    {activeTab === 'metadata' && <JsonTab data={doc.metadata} />}
  </>
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
              href={safeHref(url)}
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
