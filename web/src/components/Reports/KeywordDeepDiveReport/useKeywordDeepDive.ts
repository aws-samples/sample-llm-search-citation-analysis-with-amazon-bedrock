import { useEffect } from 'react';
import { useVisibilityMetrics } from '../../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../../hooks/useHistoricalTrends';
import { usePersonaRankings } from '../../../hooks/usePersonaRankings';
import { useBrandMentions } from '../../../hooks/useBrandMentions';
import { useCitationGaps } from '../../../hooks/useCitationGaps';
import { useRecommendations } from '../../../hooks/useRecommendations';
import { useReportReady } from '../layout/useReportReady';
import type { ReportScope } from '../../../types';
import { isGroupVisibilityResponse } from '../../../types/domain/visibility';

/**
 * Compose every fetch the Keyword Deep Dive report needs into a single hook.
 *
 * Each underlying hook owns its own loading state, error message, and data
 * shape. We re-trigger them when `keyword` changes and roll all loading
 * flags into one `ready` boolean for the auto-print scheduler.
 *
 * `useBrandMentions` is auto-fetching (it watches `keyword` itself) while
 * the other hooks are imperative — we drive their `fetch...` callbacks from
 * the effect below.
 */
export function useKeywordDeepDive(keyword: string | null) {
  const visibility = useVisibilityMetrics();
  const trends = useHistoricalTrends();
  const personas = usePersonaRankings();
  const gaps = useCitationGaps();
  const recommendations = useRecommendations();

  const mentions = useBrandMentions(keyword ? {
    kind: 'keyword',
    keyword 
  } : null);

  const fetchVisibility = visibility.fetchVisibilityMetrics;
  const fetchTrends = trends.fetchHistoricalTrends;
  const fetchPersonas = personas.fetchPersonaRankings;
  const fetchGaps = gaps.fetchCitationGaps;
  const fetchRecs = recommendations.fetchRecommendations;

  useEffect(() => {
    if (!keyword) return;
    const scope: ReportScope = {
      kind: 'keyword',
      keyword 
    };
    fetchVisibility(scope);
    fetchTrends(scope, 'day', 30);
    fetchPersonas(keyword);
    fetchGaps(scope);
    fetchRecs(false);
  }, [
    keyword,
    fetchVisibility,
    fetchTrends,
    fetchPersonas,
    fetchGaps,
    fetchRecs,
  ]);

  const ready = useReportReady([
    visibility,
    trends,
    personas,
    mentions,
    gaps,
    recommendations,
  ]);

  // This report is per keyword; the group shape cannot arrive here, but the
  // union is narrowed so the sections keep their single-keyword types.
  const keywordVisibility = visibility.data && !isGroupVisibilityResponse(visibility.data) ? visibility.data : null;

  return {
    visibility: keywordVisibility,
    visibilityError: visibility.error,
    visibilityLoading: visibility.loading,
    trends: trends.data,
    trendsError: trends.error,
    trendsLoading: trends.loading,
    personas: personas.data,
    personasError: personas.error,
    personasLoading: personas.loading,
    mentions: mentions.data,
    mentionsError: mentions.error,
    mentionsLoading: mentions.loading,
    gaps: gaps.data,
    gapsError: gaps.error,
    gapsLoading: gaps.loading,
    recommendations: recommendations.data,
    recommendationsError: recommendations.error,
    recommendationsLoading: recommendations.loading,
    ready,
  };
}
