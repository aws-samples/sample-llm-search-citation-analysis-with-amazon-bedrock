import {
  useEffect, useState, type ReactNode
} from 'react';
import { useRecommendations } from '../../hooks/useRecommendations';
import { useSeoGeoInsights } from '../../hooks/useSeoGeoInsights';
import { useScopedList } from '../../hooks/useScopedList';
import {
  isRecommendation, RECOMMENDATIONS_PAGING
} from '../../api/scopedListPagings';
import { ComputingState } from '../ui/ComputingState';
import { ScopeCoverageNote } from '../ui/ScopeCoverageNote';
import { ScopedListFooter } from '../ui/ScopedListFooter';
import { ExportAllButton } from '../ui/ExportAllButton';
import {
  RecommendationsHeader, recommendationExportParams
} from './RecommendationsHeader';
import type {
  Keyword, Recommendation, RecommendationStatus, RecommendationsResponse
} from '../../types';
import type { SeoRecommendation } from '../../types/api/seoDomains';
import { RecommendationsSkeleton } from './InsightsSkeletons';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  INFO_CIRCLE_PATHS, SPARKLES_PATHS
} from '../ui/iconPaths';
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
    <div className="bg-white p-3 sm:p-4 rounded-lg shadow-sm border-l-4 border-red-500">
      <div className="text-xs sm:text-sm text-gray-500">High Priority</div>
      <div className="text-xl sm:text-2xl font-bold text-red-600">{byPriority.high}</div>
      <div className="text-xs text-gray-400 hidden sm:block">Urgent actions needed</div>
    </div>
    <div className="bg-white p-3 sm:p-4 rounded-lg shadow-sm border-l-4 border-yellow-500">
      <div className="text-xs sm:text-sm text-gray-500">Medium</div>
      <div className="text-xl sm:text-2xl font-bold text-yellow-600">{byPriority.medium}</div>
      <div className="text-xs text-gray-400 hidden sm:block">Should address soon</div>
    </div>
    <div className="bg-white p-3 sm:p-4 rounded-lg shadow-sm border-l-4 border-green-500">
      <div className="text-xs sm:text-sm text-gray-500">Low</div>
      <div className="text-xl sm:text-2xl font-bold text-green-600">{byPriority.low}</div>
      <div className="text-xs text-gray-400 hidden sm:block">Nice to have</div>
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
  /** The rule-based recommendations loaded so far (every page, 2.45.0), statuses applied. */
  rows: Recommendation[];
  seoRecommendations: readonly SeoRecommendation[];
  /** Below the list: the next page and how many are shown. */
  footer: ReactNode;
  expandedCard: number | null;
  onCardClick: (index: number) => void;
  useLlm: boolean;
  updatingIds: readonly string[];
  onStatusChange: (recommendation: TrackedRecommendation, status: RecommendationStatus) => void;
}

const RecommendationsContent = ({
  data,
  rows,
  seoRecommendations,
  footer,
  expandedCard,
  onCardClick,
  useLlm,
  updatingIds,
  onStatusChange,
}: RecommendationsContentProps) => {
  const llmEnhanced = data.llm_enhanced ?? [];
  const hasLlmEnhanced = llmEnhanced.length > 0;
  const recommendations = mergeRecommendations(rows, seoRecommendations);
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
      {footer}

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

/** `rows` with the statuses saved since they loaded (a status saved on page 1 shows on every page). */
function withSavedStatuses(rows: readonly Recommendation[], saved: Readonly<Record<string, RecommendationStatus>>): Recommendation[] {
  return rows.map((row) => (row.id !== undefined && row.id in saved ? {
    ...row,
    status: saved[row.id],
  } : row));
}

interface RecommendationsNotesProps {
  readonly error: string | null;
  readonly savingError: string | null | undefined;
  readonly seoError: string | null | undefined;
}

/** The load error, a status that was not saved, and the SEO list being unavailable. */
const RecommendationsNotes = ({
  error, savingError, seoError
}: RecommendationsNotesProps) => (
  <>
    {error && <ErrorState error={error} />}
    {savingError && (
      <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
        Status not saved: {savingError}
      </div>
    )}
    {seoError && <SeoUnavailableNote error={seoError} />}
  </>
);

export function Recommendations({ keywords }: Props) {
  const [useLlm, setUseLlm] = useState(false);
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const selection = useScopeSelection();
  const {
    data, loading, error, computing, request, savedStatuses, fetchRecommendations, updateStatus, updatingIds, statusError
  } = useRecommendations(selection.scope);
  const seoItems = useSeoActionItems(selection);
  const pending = loading || selection.scopePending;
  // Only an answer for the selected scope is shown; while one is in flight, nothing is.
  const recommendations = pending ? null : data;
  const savingError = statusError ?? seoItems.seo.statusError;
  const pages = useScopedList(recommendations, request, RECOMMENDATIONS_PAGING, isRecommendation);

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
    // The answer-based item as the API sent it (any page loaded), without the source tag the merged list adds.
    const original = pages.items.find((item) => item.id === id);
    if (original !== undefined) void updateStatus({
      ...original,
      id,
    }, status);
  };

  return (
    <div className="space-y-6">
      <RecommendationsHeader
        useLlm={useLlm}
        setUseLlm={setUseLlm}
        onRefresh={() => fetchRecommendations(useLlm)}
        scopeSelector={<InsightsScopeSelector keywords={keywords} selection={selection} label="Analyze" />}
        exportButton={<ExportAllButton view="recommendations" params={pending ? null : recommendationExportParams(request)} />}
      />

      {recommendations && (
        <PrioritySummary byPriority={withSeoPriorities(recommendations.by_priority, seoItems.recommendations)} />
      )}

      {recommendations && <ScopeCoverageNote response={recommendations} />}
      {pending && (computing === null ? <RecommendationsSkeleton useLlm={useLlm} /> : <ComputingState subject="recommendations" />)}
      <RecommendationsNotes error={error} savingError={savingError} seoError={seoItems.seo.error} />

      {recommendations && !error && (
        <RecommendationsContent
          data={recommendations}
          rows={withSavedStatuses(pages.items, savedStatuses)}
          seoRecommendations={seoItems.recommendations}
          footer={<ScopedListFooter list={pages} noun="recommendations" autoLoad />}
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
