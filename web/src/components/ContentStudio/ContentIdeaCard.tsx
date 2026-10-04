import type { ContentIdea } from '../../types';
import { Spinner } from '../ui/Spinner';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  DOCUMENT_TEXT_PATHS, EYE_PATHS, HASHTAG_PATHS, LIGHTBULB_PATHS, LINK_PATHS, PENCIL_ALT_PATHS, SORT_ASCENDING_PATHS, WARNING_PATHS 
} from '../ui/iconPaths';

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
    <StrokeIcon className="w-5 h-5" paths={EYE_PATHS} />
  ),
  ranking_improvement: (
    <StrokeIcon className="w-5 h-5" paths={['M13 7h8m0 0v8m0-8l-8 8-4-4-6 6']} />
  ),
  provider_gap: (
    <StrokeIcon className="w-5 h-5" paths={['M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z']} />
  ),
  self_reflection: (
    <StrokeIcon className="w-5 h-5" paths={LIGHTBULB_PATHS} />
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
    <StrokeIcon className="w-3.5 h-3.5" paths={HASHTAG_PATHS} />
  );

  const contentIcon = (
    <StrokeIcon className="w-3.5 h-3.5" paths={DOCUMENT_TEXT_PATHS} />
  );

  const competitorIcon = (
    <StrokeIcon className="w-3.5 h-3.5" paths={['M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z']} />
  );

  const sourcesIcon = (
    <StrokeIcon className="w-3.5 h-3.5" paths={LINK_PATHS} />
  );

  const warningIcon = (
    <StrokeIcon className="w-3.5 h-3.5" paths={WARNING_PATHS} />
  );

  const rankIcon = (
    <StrokeIcon className="w-3.5 h-3.5" paths={SORT_ASCENDING_PATHS} />
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
              {idea.persona_name && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-50 border border-purple-200 text-purple-700">
                  {idea.persona_name}
                </span>
              )}
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
              <StrokeIcon className="w-4 h-4" paths={PENCIL_ALT_PATHS} />
              Create Content
            </>
          )}
        </button>
      </div>
    </div>
  );
};
