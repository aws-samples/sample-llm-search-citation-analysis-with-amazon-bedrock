import type { ContentIdea } from '../../types';
import { Spinner } from '../ui/Spinner';

interface ContentIdeaCardProps {
  idea: ContentIdea;
  onGenerate: (idea: ContentIdea) => void;
  isGenerating: boolean;
}

const priorityStyles = {
  high: 'bg-red-50 border-red-200 text-red-700',
  medium: 'bg-amber-50 border-amber-200 text-amber-700',
  low: 'bg-gray-50 border-gray-200 text-gray-600'
};

const typeIcons: Record<string, JSX.Element> = {
  visibility_gap: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  ranking_improvement: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
  provider_gap: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
    </svg>
  )
};

const contentAngleLabels: Record<string, string> = {
  comprehensive_guide: 'Comprehensive Guide',
  differentiation: 'Differentiation Content',
  provider_optimization: 'AI-Optimized Content'
};

const getPriorityIconClass = (priority: string): string => {
  if (priority === 'high') return 'bg-red-100 text-red-600';
  if (priority === 'medium') return 'bg-amber-100 text-amber-600';
  return 'bg-gray-100 text-gray-600';
};

interface MetadataItemProps {
  icon: JSX.Element;
  children: React.ReactNode;
  className?: string;
}

const MetadataItem = ({
  icon, children, className = '' 
}: MetadataItemProps) => (
  <span className={`flex items-center gap-1 ${className}`}>
    {icon}
    {children}
  </span>
);

const IdeaMetadata = ({ idea }: { idea: ContentIdea }) => {
  const keywordIcon = (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
    </svg>
  );

  const contentIcon = (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );

  const competitorIcon = (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );

  const sourcesIcon = (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  );

  const warningIcon = (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );

  const rankIcon = (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
    </svg>
  );

  return (
    <div className="flex flex-wrap gap-2 sm:gap-3 text-xs text-gray-500">
      {idea.keyword && <MetadataItem icon={keywordIcon}>{idea.keyword}</MetadataItem>}
      {idea.content_angle && (
        <MetadataItem icon={contentIcon}>
          {contentAngleLabels[idea.content_angle] ?? idea.content_angle}
        </MetadataItem>
      )}
      {idea.competitor_brands && idea.competitor_brands.length > 0 && (
        <MetadataItem icon={competitorIcon}>{idea.competitor_brands.length} competitors</MetadataItem>
      )}
      {idea.competitor_urls && idea.competitor_urls.length > 0 && (
        <MetadataItem icon={sourcesIcon}>{idea.competitor_urls.length} sources</MetadataItem>
      )}
      {idea.providers_missing && idea.providers_missing.length > 0 && (
        <MetadataItem icon={warningIcon} className="text-amber-600">
          Missing: {idea.providers_missing.join(', ')}
        </MetadataItem>
      )}
      {idea.current_rank && (
        <MetadataItem icon={rankIcon} className="text-amber-600">
          Current rank: #{idea.current_rank}
        </MetadataItem>
      )}
    </div>
  );
};

export const ContentIdeaCard = ({
  idea, onGenerate, isGenerating
}: ContentIdeaCardProps) => {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5 hover:border-gray-300 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3 sm:gap-4 flex-1">
          <div className={`p-2 rounded-lg shrink-0 ${getPriorityIconClass(idea.priority)}`}>
            {typeIcons[idea.type] ?? typeIcons.visibility_gap}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="font-medium text-gray-900 text-sm sm:text-base">{idea.title}</h3>
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${priorityStyles[idea.priority]}`}>
                {idea.priority}
              </span>
            </div>

            <p className="text-sm text-gray-600 mb-3">{idea.description}</p>

            <IdeaMetadata idea={idea} />
          </div>
        </div>

        <button
          onClick={() => onGenerate(idea)}
          disabled={isGenerating}
          className="w-full sm:w-auto px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
        >
          {isGenerating ? (
            <>
              <Spinner size="sm" />
              Creating...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Create Content
            </>
          )}
        </button>
      </div>
    </div>
  );
};
