import {
  useEffect, useState 
} from 'react';
import { useRecommendations } from '../../hooks/useRecommendations';
import { Recommendation } from '../../types';
import { Spinner } from '../ui/Spinner';

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

const VisibilityIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const RankingIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
  </svg>
);

const ProviderGapIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);

const CompetitiveIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const ConfigurationIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const DataIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const BestPracticeIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);

const DefaultIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
);

const getTypeIcon = (type: string): JSX.Element => {
  const icons: Record<string, JSX.Element> = {
    visibility_gap: <VisibilityIcon />,
    ranking: <RankingIcon />,
    provider_gap: <ProviderGapIcon />,
    competitive: <CompetitiveIcon />,
    configuration: <ConfigurationIcon />,
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
              <svg 
                className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
              </svg>
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
  <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
    <div className="flex flex-col gap-4">
      <div className="flex-1">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Action Center</h2>
        <p className="text-sm text-gray-500 mt-2 leading-relaxed">
          Get prioritized, actionable recommendations to improve your AI search visibility. 
          Each recommendation is based on analysis of your visibility gaps, competitor performance, 
          and citation patterns. Enable "AI Enhanced" for deeper, LLM-powered insights.
        </p>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-700 rounded-full text-xs sm:text-sm">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="hidden sm:inline">Start with high-priority items for biggest impact</span>
            <span className="sm:hidden">Start with high-priority items</span>
          </span>
        </div>
      </div>
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
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>
    </div>
  </div>
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
      <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
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
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
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

export default Recommendations;
