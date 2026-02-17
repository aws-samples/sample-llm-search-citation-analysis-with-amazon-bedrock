import { useState } from 'react';
import type {
  ContentIdea, GeneratedContent
} from '../../types';
import { Spinner } from '../ui/Spinner';

interface ContentGeneratorProps {
  idea: ContentIdea;
  content: GeneratedContent | null;
  isGenerating: boolean;
  onClose: () => void;
}

interface CopyButtonProps {
  copied: boolean;
  onCopy: () => void;
}

const CopyButton = ({
  copied, onCopy 
}: CopyButtonProps) => (
  <button
    onClick={onCopy}
    className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
  >
    {copied ? (
      <>
        <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Copied!
      </>
    ) : (
      <>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        Copy
      </>
    )}
  </button>
);

interface ContentSectionProps {
  label: string;
  children: React.ReactNode;
  copied: boolean;
  onCopy: () => void;
  subtitle?: string;
}

const ContentSection = ({
  label, children, copied, onCopy, subtitle 
}: ContentSectionProps) => (
  <div className="bg-gray-50 rounded-lg p-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</span>
      <CopyButton copied={copied} onCopy={onCopy} />
    </div>
    {children}
    {subtitle && <span className="text-xs text-gray-400 mt-1 block">{subtitle}</span>}
  </div>
);

const GeneratingState = () => (
  <div className="flex flex-col items-center justify-center py-16">
    <Spinner size="lg" className="text-gray-400 mb-4" />
    <p className="text-gray-600 font-medium">Generating optimized content...</p>
    <p className="text-sm text-gray-500 mt-1">This may take 30-60 seconds</p>
  </div>
);

const EmptyState = () => (
  <div className="text-center py-16 text-gray-500">
    No content generated yet
  </div>
);

interface GeneratedContentDisplayProps {
  content: GeneratedContent;
  copied: string | null;
  onCopy: (text: string, type: string) => void;
}

const GeneratedContentDisplay = ({
  content, copied, onCopy 
}: GeneratedContentDisplayProps) => (
  <div className="space-y-6">
    <ContentSection
      label="Title"
      copied={copied === 'title'}
      onCopy={() => onCopy(content.title, 'title')}
    >
      <h1 className="text-xl font-semibold text-gray-900">{content.title}</h1>
    </ContentSection>

    <ContentSection
      label="Meta Description"
      copied={copied === 'meta'}
      onCopy={() => onCopy(content.meta_description, 'meta')}
      subtitle={`${content.meta_description.length}/160 characters`}
    >
      <p className="text-sm text-gray-700">{content.meta_description}</p>
    </ContentSection>

    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Content Body</span>
        <CopyButton copied={copied === 'body'} onCopy={() => onCopy(content.body, 'body')} />
      </div>
      <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
        {content.body}
      </div>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {content.suggested_headings.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-2">Suggested Headings</span>
          <ul className="space-y-1">
            {content.suggested_headings.map((heading) => (
              <li key={heading} className="text-sm text-gray-700 flex items-start gap-2">
                <span className="text-gray-400">H2:</span>
                {heading}
              </li>
            ))}
          </ul>
        </div>
      )}

      {content.key_points.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-2">Key Takeaways</span>
          <ul className="space-y-1">
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
  </div>
);

export const ContentGenerator = ({
  idea, content, isGenerating, onClose
}: ContentGeneratorProps) => {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (text: string, type: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCopyAll = async () => {
    if (!content) return;
    const fullContent = `# ${content.title}\n\n${content.meta_description}\n\n${content.body}`;
    await navigator.clipboard.writeText(fullContent);
    setCopied('all');
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {isGenerating ? 'Generating Content...' : 'Generated Content'}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Keyword: {idea.keyword}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isGenerating && <GeneratingState />}
          {!isGenerating && content && (
            <GeneratedContentDisplay content={content} copied={copied} onCopy={handleCopy} />
          )}
          {!isGenerating && !content && <EmptyState />}
        </div>

        {content && !isGenerating && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
            <p className="text-sm text-gray-500">Content saved to history</p>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleCopyAll}
                className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2"
              >
                {copied === 'all' ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied All!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy All Content
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
