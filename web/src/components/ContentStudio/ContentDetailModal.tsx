import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ContentStudioHistory } from '../../types';
import { Spinner } from '../ui/Spinner';
import { exportToDocx } from '../../exporters/documentGenerator';
import { CopyButtonLabel } from './CopyButtonLabel';
import { useExportAction } from '../ui/useExportAction';
import { OverlayDialog } from './OverlayDialog';
import {
  formatContentWarning, getContentTitle
} from './contentPresentation';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  CHECK_PATHS, CLOSE_PATHS, DOWNLOAD_PATHS, HASHTAG_PATHS 
} from '../ui/iconPaths';

interface ContentDetailModalProps {
  item: ContentStudioHistory;
  onClose: () => void;
  onCopy: (text: string) => void;
  copied: boolean;
}

export const ContentDetailModal = ({
  item, onClose, onCopy, copied
}: ContentDetailModalProps) => {
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview');

  const content = item.generated_content;
  const displayTitle = getContentTitle(item);
  const fullContent = `# ${displayTitle}\n\n${content?.meta_description ?? ''}\n\n${content?.body ?? ''}`;

  const {
    exporting, handleExport: handleExportDocx 
  } = useExportAction(
    content
      ? () => exportToDocx({
        content: {
          ...content,
          title: displayTitle,
        },
        keyword: item.keyword
      })
      : null,
    'Error exporting to DOCX:',
  );

  return (
    <OverlayDialog onDismiss={onClose} panelClassName="max-w-4xl w-full max-h-[90vh] overflow-hidden">
      <ContentDetailHeader
        item={item}
        title={displayTitle}
        viewMode={viewMode}
        setViewMode={setViewMode}
        exporting={exporting}
        onExportDocx={handleExportDocx}
        onCopy={() => onCopy(fullContent)}
        copied={copied}
        onClose={onClose}
      />
      <ContentDetailBody
        content={content}
        contentWarning={item.content_warning}
        viewMode={viewMode}
      />
    </OverlayDialog>
  );
};

interface ContentDetailHeaderProps {
  item: ContentStudioHistory;
  title: string;
  viewMode: 'preview' | 'raw';
  setViewMode: (mode: 'preview' | 'raw') => void;
  exporting: boolean;
  onExportDocx: () => void;
  onCopy: () => void;
  copied: boolean;
  onClose: () => void;
}

const ContentDetailHeader = ({
  item, title, viewMode, setViewMode, exporting, onExportDocx, onCopy, copied, onClose
}: ContentDetailHeaderProps) => (
  <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
    <div className="flex-1 min-w-0 pr-4">
      <h2 className="text-lg font-semibold text-gray-900 truncate">
        {title}
      </h2>
      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
        <span className="flex items-center gap-1">
          <StrokeIcon className="w-3.5 h-3.5" paths={HASHTAG_PATHS} />
          {item.keyword}
        </span>
        <span>•</span>
        <span>{new Date(item.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}</span>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <ViewModeToggle viewMode={viewMode} setViewMode={setViewMode} />
      <ExportButton exporting={exporting} onExport={onExportDocx} />
      <CopyButton copied={copied} onCopy={onCopy} />
      <CloseButton onClose={onClose} />
    </div>
  </div>
);

interface ViewModeToggleProps {
  viewMode: 'preview' | 'raw';
  setViewMode: (mode: 'preview' | 'raw') => void;
}

const ViewModeToggle = ({
  viewMode, setViewMode
}: ViewModeToggleProps) => (
  <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
    <button
      onClick={() => setViewMode('preview')}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        viewMode === 'preview'
          ? 'bg-white text-gray-900 shadow-sm'
          : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      Preview
    </button>
    <button
      onClick={() => setViewMode('raw')}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        viewMode === 'raw'
          ? 'bg-white text-gray-900 shadow-sm'
          : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      Markdown
    </button>
  </div>
);

interface ExportButtonProps {
  exporting: boolean;
  onExport: () => void;
}

const ExportButton = ({
  exporting, onExport
}: ExportButtonProps) => (
  <button
    onClick={onExport}
    disabled={exporting}
    className="px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
    title="Download as Word document"
  >
    {exporting ? (
      <Spinner size="sm" />
    ) : (
      <StrokeIcon className="w-4 h-4" paths={DOWNLOAD_PATHS} />
    )}
    .docx
  </button>
);

interface CopyButtonProps {
  copied: boolean;
  onCopy: () => void;
}

const CopyButton = ({
  copied, onCopy
}: CopyButtonProps) => (
  <button
    onClick={onCopy}
    className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
  >
    <CopyButtonLabel copied={copied} iconClassName="w-4 h-4" label="Copy All" />
  </button>
);

interface CloseButtonProps {onClose: () => void;}

const CloseButton = ({ onClose }: CloseButtonProps) => (
  <button
    onClick={onClose}
    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
    aria-label="Close content details"
  >
    <StrokeIcon className="w-5 h-5" paths={CLOSE_PATHS} />
  </button>
);

interface ContentWarningBannerProps {contentWarning: ContentStudioHistory['content_warning'];}

const ContentWarningBanner = ({ contentWarning }: ContentWarningBannerProps) => {
  if (!contentWarning) return null;
  return (
    <output className="block rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      {formatContentWarning(contentWarning)}
    </output>
  );
};

interface ContentDetailBodyProps {
  content: ContentStudioHistory['generated_content'];
  contentWarning: ContentStudioHistory['content_warning'];
  viewMode: 'preview' | 'raw';
}

const ContentDetailBody = ({
  content, contentWarning, viewMode
}: ContentDetailBodyProps) => (
  <div className="overflow-y-auto max-h-[calc(90vh-80px)] p-6 space-y-6">
    <ContentWarningBanner contentWarning={contentWarning} />

    {content?.meta_description && (
      <div className="bg-gray-50 rounded-lg p-4">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Meta Description</span>
        <p className="text-sm text-gray-700 mt-2">{content.meta_description}</p>
      </div>
    )}

    {content?.body && (
      <div>
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Content</span>
        <div className="mt-2">
          {viewMode === 'preview' ? (
            <div className="prose-markdown text-gray-700">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.body}</ReactMarkdown>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-4 font-mono text-sm text-gray-700 whitespace-pre-wrap leading-relaxed overflow-x-auto">
              {content.body}
            </div>
          )}
        </div>
      </div>
    )}

    {content?.suggested_headings && content.suggested_headings.length > 0 && (
      <div className="bg-gray-50 rounded-lg p-4">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Suggested Headings</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {content.suggested_headings.map((heading) => (
            <span key={heading} className="text-xs bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-full">
              {heading}
            </span>
          ))}
        </div>
      </div>
    )}

    {content?.key_points && content.key_points.length > 0 && (
      <div className="bg-gray-50 rounded-lg p-4">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Key Points</span>
        <ul className="mt-2 space-y-2">
          {content.key_points.map((point) => (
            <li key={point} className="text-sm text-gray-700 flex items-start gap-2">
              <StrokeIcon className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" paths={CHECK_PATHS} strokeWidth={2} />
              {point}
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
);
