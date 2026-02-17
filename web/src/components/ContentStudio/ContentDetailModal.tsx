import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ContentStudioHistory } from '../../types';
import { Spinner } from '../ui/Spinner';
import { exportToDocx } from '../../exporters/documentGenerator';

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
  const [exporting, setExporting] = useState(false);

  const content = item.generated_content;
  const fullContent = `# ${content?.title ?? ''}\n\n${content?.meta_description ?? ''}\n\n${content?.body ?? ''}`;

  const handleExportDocx = async () => {
    if (!content) return;
    setExporting(true);

    try {
      await exportToDocx({
        content,
        keyword: item.keyword 
      });
    } catch (error) {
      console.error('Error exporting to DOCX:', error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-900/50 transition-opacity" onClick={onClose} />

        <div className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
          <ContentDetailHeader
            item={item}
            content={content}
            viewMode={viewMode}
            setViewMode={setViewMode}
            exporting={exporting}
            onExportDocx={handleExportDocx}
            onCopy={() => onCopy(fullContent)}
            copied={copied}
            onClose={onClose}
          />
          <ContentDetailBody content={content} viewMode={viewMode} />
        </div>
      </div>
    </div>
  );
};

interface ContentDetailHeaderProps {
  item: ContentStudioHistory;
  content: ContentStudioHistory['generated_content'];
  viewMode: 'preview' | 'raw';
  setViewMode: (mode: 'preview' | 'raw') => void;
  exporting: boolean;
  onExportDocx: () => void;
  onCopy: () => void;
  copied: boolean;
  onClose: () => void;
}

const ContentDetailHeader = ({
  item, content, viewMode, setViewMode, exporting, onExportDocx, onCopy, copied, onClose
}: ContentDetailHeaderProps) => (
  <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
    <div className="flex-1 min-w-0 pr-4">
      <h2 className="text-lg font-semibold text-gray-900 truncate">
        {content?.title ?? item.idea_title}
      </h2>
      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
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
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
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
    {copied ? (
      <>
        <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Copied!
      </>
    ) : (
      <>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        Copy All
      </>
    )}
  </button>
);

interface CloseButtonProps {onClose: () => void;}

const CloseButton = ({ onClose }: CloseButtonProps) => (
  <button
    onClick={onClose}
    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
  >
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
);

interface ContentDetailBodyProps {
  content: ContentStudioHistory['generated_content'];
  viewMode: 'preview' | 'raw';
}

const ContentDetailBody = ({
  content, viewMode 
}: ContentDetailBodyProps) => (
  <div className="overflow-y-auto max-h-[calc(90vh-80px)] p-6 space-y-6">
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
              <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {point}
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
);
