import {
  useEffect, useState, type ReactNode
} from 'react';
import { useRecommendations } from '../../hooks/useRecommendations';
import { useSeoGeoInsights } from '../../hooks/useSeoGeoInsights';
import type {
  Keyword, Recommendation, RecommendationStatus, RecommendationsResponse
} from '../../types';
import type { SeoRecommendation } from '../../types/api/seoDomains';
import { RecommendationsSkeleton } from './InsightsSkeletons';
import { RefreshIcon } from '../ui';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  BOLT_PATHS, INFO_CIRCLE_PATHS, SPARKLES_PATHS
} from '../ui/iconPaths';
import { PageHeaderCard } from '../ui/PageHeaderCard';
import { InsightsScopeSelector } from './InsightsScopeSelector';
import { RecommendationCard } from './RecommendationCard';
import { RecommendationStatusSelect } from './RecommendationStatusSelect';
import {
  mergeRecommendations, seoRecommendationsForScope, withSeoPriorities, type ActionCenterRecommendation
} from './recommendationSources';
import { useScopeSelection } from './useScopeSelection';

type TrackedRecommendation = ActionCenterRecommendation & { id: string };

function isTracked(rec: ActionCenterRecommendation): rec is TrackedRecommendation {
  return typeof rec.id === 'string' && rec.id !== '';
}

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
  scopeSelector: ReactNode;
}

const Header = ({
  useLlm, setUseLlm, onRefresh, scopeSelector
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
    {scopeSelector}
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

const LLM_HINTS = {
  empty: 'AI enhancement is enabled but no additional recommendations were generated.',
  timedOut: 'The AI model did not answer in time, so only the rule-based recommendations are shown. Try again.',
} as const;

const LlmHint = ({ timedOut }: { readonly timedOut: boolean }) => (
  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-700">
    <div className="flex items-center gap-2">
      <StrokeIcon className="w-4 h-4" paths={INFO_CIRCLE_PATHS} />
      {timedOut ? LLM_HINTS.timedOut : LLM_HINTS.empty}
    </div>
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

/** The SEO list failed on its own: the answer-based list above stays as it is. */
const SeoUnavailableNote = ({ error }: { error: string }) => (
  <output className="block bg-gray-50 border border-gray-200 text-gray-600 rounded-lg p-3 text-sm">
    SEO recommendations are unavailable: {error}
  </output>
);

interface RecommendationsListProps {
  recommendations: ActionCenterRecommendation[];
  expandedCard: number | null;
  onCardClick: (index: number) => void;
  updatingIds: readonly string[];
  onStatusChange: (recommendation: TrackedRecommendation, status: RecommendationStatus) => void;
}

const RecommendationsList = ({
  recommendations, expandedCard, onCardClick, updatingIds, onStatusChange
}: RecommendationsListProps) => (
  <div className="space-y-4">
    {recommendations.map((rec, i) => (
      <RecommendationCard
        key={`${rec.source}:${rec.id ?? rec.title}`}
        rec={rec}
        fromSeo={rec.source === 'seo'}
        isExpanded={expandedCard === i}
        onClick={() => onCardClick(i)}
        statusControl={isTracked(rec) && (
          <RecommendationStatusSelect
            recommendation={rec}
            updating={updatingIds.includes(rec.id)}
            onChange={(_selected, status) => onStatusChange(rec, status)}
          />
        )}
      />
    ))}
  </div>
);

interface RecommendationsContentProps {
  data: RecommendationsResponse;
  seoRecommendations: readonly SeoRecommendation[];
  expandedCard: number | null;
  onCardClick: (index: number) => void;
  useLlm: boolean;
  updatingIds: readonly string[];
  onStatusChange: (recommendation: TrackedRecommendation, status: RecommendationStatus) => void;
}

const RecommendationsContent = ({
  data,
  seoRecommendations,
  expandedCard,
  onCardClick,
  useLlm,
  updatingIds,
  onStatusChange,
}: RecommendationsContentProps) => {
  const llmEnhanced = data.llm_enhanced ?? [];
  const hasLlmEnhanced = llmEnhanced.length > 0;
  const recommendations = mergeRecommendations(data.recommendations, seoRecommendations);
  const showLlmHint = useLlm && !hasLlmEnhanced;
  const showEmptyState = recommendations.length === 0;

  return (
    <>
      {recommendations.length > 0 && (
        <RecommendationsList
          recommendations={recommendations}
          expandedCard={expandedCard}
          onCardClick={onCardClick}
          updatingIds={updatingIds}
          onStatusChange={onStatusChange}
        />
      )}

      {hasLlmEnhanced && (
        <LlmEnhancedSection
          recommendations={llmEnhanced}
          expandedCard={expandedCard}
          onCardClick={onCardClick}
        />
      )}

      {showLlmHint && <LlmHint timedOut={data.llm === 'timed_out'} />}
      {showEmptyState && <EmptyState />}
    </>
  );
};

/**
 * The SEO recommendations of the selected scope (none when the SEO stack is
 * not deployed) and the status change routed to the list it belongs to.
 */
function useSeoActionItems(selection: ReturnType<typeof useScopeSelection>) {
  const { scope } = selection;
  const seo = useSeoGeoInsights(scope.kind === 'group' ? scope.groupId : null);
  const recommendations = seoRecommendationsForScope(seo.recommendations, scope);
  const find = (id: string) => recommendations.find((recommendation) => recommendation.id === id);
  return {
    seo,
    recommendations,
    find,
  };
}

interface Props { readonly keywords: Array<Keyword>; }

export function Recommendations({ keywords }: Props) {
  const [useLlm, setUseLlm] = useState(false);
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const selection = useScopeSelection();
  const {
    data, loading, error, fetchRecommendations, updateStatus, updatingIds, statusError
  } = useRecommendations(selection.scope);
  const seoItems = useSeoActionItems(selection);
  const pending = loading || selection.scopePending;
  // Only an answer for the selected scope is shown; while one is in flight, nothing is.
  const recommendations = pending ? null : data;
  const savingError = statusError ?? seoItems.seo.statusError;

  useEffect(
    () => selection.trackScopeRequest(fetchRecommendations(useLlm)),
    [fetchRecommendations, useLlm, selection.trackScopeRequest],
  );

  const handleCardClick = (index: number) => {
    setExpandedCard(expandedCard === index ? null : index);
  };

  const handleStatusChange = (recommendation: TrackedRecommendation, status: RecommendationStatus) => {
    const { id } = recommendation;
    const seoRecommendation = recommendation.source === 'seo' ? seoItems.find(id) : undefined;
    if (seoRecommendation !== undefined) {
      void seoItems.seo.updateStatus(seoRecommendation, status);
      return;
    }
    // The answer-based item as the API sent it, without the source tag the merged list adds.
    const original = data?.recommendations.find((item) => item.id === id);
    if (original !== undefined) void updateStatus({
      ...original,
      id,
    }, status);
  };

  return (
    <div className="space-y-6">
      <Header
        useLlm={useLlm}
        setUseLlm={setUseLlm}
        onRefresh={() => fetchRecommendations(useLlm)}
        scopeSelector={<InsightsScopeSelector keywords={keywords} selection={selection} label="Analyze" />}
      />

      {recommendations && (
        <PrioritySummary byPriority={withSeoPriorities(recommendations.by_priority, seoItems.recommendations)} />
      )}

      {pending && <RecommendationsSkeleton useLlm={useLlm} />}
      {error && <ErrorState error={error} />}
      {savingError && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          Status not saved: {savingError}
        </div>
      )}
      {seoItems.seo.error && <SeoUnavailableNote error={seoItems.seo.error} />}

      {recommendations && !error && (
        <RecommendationsContent
          data={recommendations}
          seoRecommendations={seoItems.recommendations}
          expandedCard={expandedCard}
          onCardClick={handleCardClick}
          useLlm={useLlm}
          updatingIds={[...updatingIds, ...seoItems.seo.updatingIds]}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
