import { useEffect } from 'react';
import { useVisibilityMetrics } from '../../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../../hooks/useHistoricalTrends';
import { usePersonaRankings } from '../../../hooks/usePersonaRankings';
import { useBrandMentions } from '../../../hooks/useBrandMentions';
import { useCitationGaps } from '../../../hooks/useCitationGaps';
import { useRecommendations } from '../../../hooks/useRecommendations';
import { useReportReady } from '../layout/useReportReady';
import { ALL_SCOPE } from '../../ui/reportScope';
import type { ReportScope } from '../../../types';

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
  const keywordScope: ReportScope | null = keyword ? {
    kind: 'keyword',
    keyword
  } : null;
  // Scoped to the report's keyword, so the recommendations match the page.
  const recommendations = useRecommendations(keywordScope ?? ALL_SCOPE);

  const mentions = useBrandMentions(keywordScope);

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

  return {
    visibility: visibility.data,
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
