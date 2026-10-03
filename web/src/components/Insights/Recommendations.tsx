import {
  useEffect, useState 
} from 'react';
import { useRecommendations } from '../../hooks/useRecommendations';
import { Recommendation } from '../../types';
import { Spinner } from '../ui/Spinner';
import {
  EyeIcon, CogIcon, RefreshIcon 
} from '../ui';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  BOLT_PATHS, CHART_BAR_PATHS, CHEVRON_DOWN_PATHS, INFO_CIRCLE_PATHS, LIGHTBULB_PATHS, LINK_PATHS, SORT_ASCENDING_PATHS, SPARKLES_PATHS 
} from '../ui/iconPaths';
import { PageHeaderCard } from '../ui/PageHeaderCard';

const getPriorityColor = (priority: string): string => {
  const colors: Record<string, string> = {
    high: 'bg-red-500',
    medium: 'bg-yellow-500',
    low: 'bg-green-500',
  };
  return colors[priority] ?? 'bg-green-500';
};

const getTypeBorderColor = (type: string): string => {
  const colors: Record<string, string> = {
    visibility_gap: 'border-purple-500',
    ranking: 'border-blue-500',
    provider_gap: 'border-orange-500',
    competitive: 'border-red-500',
    configuration: 'border-gray-500',
    data: 'border-emerald-500',
    best_practice: 'border-indigo-500',
  };
  return colors[type] ?? 'border-gray-500';
};

const RankingIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={SORT_ASCENDING_PATHS} />
);

const ProviderGapIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={LINK_PATHS} />
);

const CompetitiveIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={BOLT_PATHS} />
);

const DataIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={CHART_BAR_PATHS} />
);

const BestPracticeIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={SPARKLES_PATHS} />
);

const DefaultIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={LIGHTBULB_PATHS} />
);

const getTypeIcon = (type: string): JSX.Element => {
  const icons: Record<string, JSX.Element> = {
    visibility_gap: <EyeIcon />,
    ranking: <RankingIcon />,
    provider_gap: <ProviderGapIcon />,
    competitive: <CompetitiveIcon />,
    configuration: <CogIcon />,
    data: <DataIcon />,
    best_practice: <BestPracticeIcon />,
  };
  return icons[type] ?? <DefaultIcon />;
};

interface RecommendationCardProps {
  rec: Recommendation;
  isExpanded: boolean;
  onClick: () => void;
}

const RecommendationCard = ({
  rec, isExpanded, onClick 
}: RecommendationCardProps) => (
  <div 
    className={`bg-white rounded-lg shadow border-l-4 ${getTypeBorderColor(rec.type)} cursor-pointer transition-all hover:shadow-md ${isExpanded ? 'ring-2 ring-gray-300' : ''}`}
    onClick={onClick}
  >
    <div className="p-5">
      <div className="flex items-start gap-4">
        <div className="text-gray-400 mt-0.5">{getTypeIcon(rec.type)}</div>
        <div className="flex-1">
          <div className="flex justify-between items-start mb-2">
            <h4 className="font-semibold text-gray-900">{rec.title}</h4>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${getPriorityColor(rec.priority)}`} />
              <StrokeIcon className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} paths={CHEVRON_DOWN_PATHS} />
            </div>
          </div>
          
          <p className="text-gray-600 text-sm">{rec.description}</p>
          
          {isExpanded && <ExpandedContent rec={rec} />}
        </div>
      </div>
    </div>
  </div>
);

const ExpandedContent = ({ rec }: { rec: Recommendation }) => (
  <div className="mt-4 space-y-3 animate-in fade-in duration-200">
    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
      <div className="text-xs text-gray-500 font-medium mb-1">Action</div>
      <div className="text-sm text-gray-700">{rec.action}</div>
    </div>
    
    <div className="text-xs text-gray-500">
      <span className="font-medium">Impact:</span> {rec.impact}
    </div>

    {rec.keywords && rec.keywords.length > 0 && (
      <div className="flex flex-wrap gap-1">
        {rec.keywords.map(kw => (
          <span key={kw} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
            {kw}
          </span>
        ))}
      </div>
    )}
  </div>
);

interface PrioritySummaryProps {
  byPriority: {
    high: number;
    medium: number;
    low: number 
  };
}

const PrioritySummary = ({ byPriority }: PrioritySummaryProps) => (
  <div className="grid grid-cols-3 gap-3 sm:gap-4">
    <div className="bg-white p-3 sm:p-4 rounded-lg shadow border-l-4 border-red-500">
      <div className="text-xs sm:text-sm text-gray-500">High Priority</div>
      <div className="text-xl sm:text-2xl font-bold text-red-600">{byPriority.high}</div>
      <div className="text-xs text-gray-400 hidden sm:block">Urgent actions needed</div>
    </div>
    <div className="bg-white p-3 sm:p-4 rounded-lg shadow border-l-4 border-yellow-500">
      <div className="text-xs sm:text-sm text-gray-500">Medium</div>
      <div className="text-xl sm:text-2xl font-bold text-yellow-600">{byPriority.medium}</div>
      <div className="text-xs text-gray-400 hidden sm:block">Should address soon</div>
    </div>
    <div className="bg-white p-3 sm:p-4 rounded-lg shadow border-l-4 border-green-500">
      <div className="text-xs sm:text-sm text-gray-500">Low</div>
      <div className="text-xl sm:text-2xl font-bold text-green-600">{byPriority.low}</div>
      <div className="text-xs text-gray-400 hidden sm:block">Nice to have</div>
    </div>
  </div>
);

interface HeaderProps {
  useLlm: boolean;
  setUseLlm: (value: boolean) => void;
  onRefresh: () => void;
}

const Header = ({
  useLlm, setUseLlm, onRefresh 
}: HeaderProps) => (
  <PageHeaderCard
    title="Action Center"
    description={(
      <>
        Get prioritized, actionable recommendations to improve your AI search visibility. 
        Each recommendation is based on analysis of your visibility gaps, competitor performance, 
        and citation patterns. Enable "AI Enhanced" for deeper, LLM-powered insights.
      </>
    )}
    note={(
      <div className="mt-3 flex items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-700 rounded-full text-xs sm:text-sm">
          <StrokeIcon className="w-3.5 h-3.5" paths={BOLT_PATHS} strokeWidth={2} />
          <span className="hidden sm:inline">Start with high-priority items for biggest impact</span>
          <span className="sm:hidden">Start with high-priority items</span>
        </span>
      </div>
    )}
  >
    <div className="flex flex-col sm:flex-row gap-3">
      <label className="flex items-center gap-2 text-sm bg-gray-50 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
        <input
          type="checkbox"
          checked={useLlm}
          onChange={(e) => setUseLlm(e.target.checked)}
          className="rounded border-gray-300 text-gray-900 focus:ring-gray-900"
        />
        <span className="text-gray-700 font-medium">AI Enhanced</span>
      </label>
      <button
        onClick={onRefresh}
        className="px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 text-sm font-medium transition-colors flex items-center justify-center gap-2"
      >
        <RefreshIcon className="w-4 h-4" />
        Refresh
      </button>
    </div>
  </PageHeaderCard>
);

const LlmEnhancedSection = ({ 
  recommendations, 
  expandedCard, 
  onCardClick 
}: { 
  recommendations: Recommendation[];
  expandedCard: number | null;
  onCardClick: (index: number) => void;
}) => (
  <div className="mt-8">
    <h3 className="text-lg font-medium mb-4 flex items-center gap-2 text-gray-900">
      <StrokeIcon className="w-5 h-5 text-indigo-500" paths={SPARKLES_PATHS} />
      AI-Enhanced Recommendations
    </h3>
    <div className="space-y-4">
      {recommendations.map((rec, i) => {
        const cardIndex = i + 1000;
        return (
          <RecommendationCard
            key={cardIndex}
            rec={rec}
            isExpanded={expandedCard === cardIndex}
            onClick={() => onCardClick(cardIndex)}
          />
        );
      })}
    </div>
  </div>
);

const LlmHint = () => (
  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-700">
    <div className="flex items-center gap-2">
      <StrokeIcon className="w-4 h-4" paths={INFO_CIRCLE_PATHS} />
      AI enhancement is enabled but no additional recommendations were generated.
    </div>
  </div>
);

const LoadingState = ({ useLlm }: { useLlm: boolean }) => (
  <div className="text-center py-8 text-gray-500 flex items-center justify-center gap-2">
    <Spinner size="sm" />
    {useLlm ? 'Generating AI-enhanced recommendations...' : 'Generating recommendations...'}
  </div>
);

const ErrorState = ({ error }: { error: string }) => (
  <div className="text-center py-8 text-red-500">{error}</div>
);

const EmptyState = () => (
  <div className="text-center py-8 text-gray-500">
    No recommendations available. Configure your brands and run analyses to get started.
  </div>
);

interface RecommendationsListProps {
  recommendations: Recommendation[];
  expandedCard: number | null;
  onCardClick: (index: number) => void;
}

const RecommendationsList = ({
  recommendations, expandedCard, onCardClick 
}: RecommendationsListProps) => (
  <div className="space-y-4">
    {recommendations.map((rec, i) => (
      <RecommendationCard
        key={rec.title}
        rec={rec}
        isExpanded={expandedCard === i}
        onClick={() => onCardClick(i)}
      />
    ))}
  </div>
);

interface RecommendationsContentProps {
  data: NonNullable<ReturnType<typeof useRecommendations>['data']>;
  loading: boolean;
  error: string | null;
  expandedCard: number | null;
  onCardClick: (index: number) => void;
  useLlm: boolean;
}

const RecommendationsContent = ({
  data,
  loading,
  error,
  expandedCard,
  onCardClick,
  useLlm,
}: RecommendationsContentProps) => {
  const llmEnhanced = data.llm_enhanced ?? [];
  const hasLlmEnhanced = llmEnhanced.length > 0;
  const recommendations = data.recommendations;
  const showLlmHint = useLlm && !hasLlmEnhanced;
  const showEmptyState = recommendations.length === 0;

  if (loading) return null;
  if (error) return null;

  return (
    <>
      {recommendations.length > 0 && (
        <RecommendationsList
          recommendations={recommendations}
          expandedCard={expandedCard}
          onCardClick={onCardClick}
        />
      )}

      {hasLlmEnhanced && (
        <LlmEnhancedSection
          recommendations={llmEnhanced}
          expandedCard={expandedCard}
          onCardClick={onCardClick}
        />
      )}

      {showLlmHint && <LlmHint />}
      {showEmptyState && <EmptyState />}
    </>
  );
};

export function Recommendations() {
  const [useLlm, setUseLlm] = useState(false);
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const {
    data, loading, error, fetchRecommendations 
  } = useRecommendations();

  useEffect(() => {
    fetchRecommendations(useLlm);
  }, [fetchRecommendations, useLlm]);

  const handleCardClick = (index: number) => {
    setExpandedCard(expandedCard === index ? null : index);
  };

  return (
    <div className="space-y-6">
      <Header useLlm={useLlm} setUseLlm={setUseLlm} onRefresh={() => fetchRecommendations(useLlm)} />

      {data && <PrioritySummary byPriority={data.by_priority} />}

      {loading && <LoadingState useLlm={useLlm} />}
      {error && <ErrorState error={error} />}

      {data && (
        <RecommendationsContent
          data={data}
          loading={loading}
          error={error}
          expandedCard={expandedCard}
          onCardClick={handleCardClick}
          useLlm={useLlm}
        />
      )}
    </div>
  );
}

