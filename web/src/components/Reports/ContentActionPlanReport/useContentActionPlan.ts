import { useEffect } from 'react';
import { useCitationGaps } from '../../../hooks/useCitationGaps';
import { useContentStudio } from '../../../hooks/useContentStudio';
import { useReportReady } from '../layout/useReportReady';
import { ALL_SCOPE } from '../../ui/reportScope';

const CITATION_GAPS_LIMIT = 50;

/**
 * Content Action Plan composes two existing data sources:
 *
 *   /citation-gaps (no keyword)        — top citation gaps across all keywords,
 *                                         already prioritised high/medium/low
 *                                         server-side and grouped by domain.
 *   /content-studio/ideas + /history   — what content we *should* generate next
 *                                         and what we already have ready to use.
 *
 * The report's job is to join these on `keyword` so a content strategist can
 * see, at a glance, "this gap exists, and you have / don't have a brief
 * targeting it." We do the join client-side because neither endpoint
 * currently knows about the other and a small per-report aggregation is
 * cheaper than a backend change.
 */
export function useContentActionPlan() {
  const gaps = useCitationGaps();
  const studio = useContentStudio();

  const { fetchCitationGaps } = gaps;
  const {
    fetchIdeas, fetchHistory 
  } = studio;

  useEffect(() => {
    fetchCitationGaps(ALL_SCOPE, CITATION_GAPS_LIMIT);
    fetchIdeas();
    fetchHistory();
  }, [fetchCitationGaps, fetchIdeas, fetchHistory]);

  // Re-shape the studio hook's state into a ReportDataSlice so it composes
  // with the citation-gaps slice via `useReportReady`. The studio hook tracks
  // ideas + history together under one `loading` flag, and once both arrays
  // are populated we treat them as settled.
  const studioSlice = {
    loading: studio.loading,
    data: studio.ideas.length > 0 || studio.history.length > 0 ? {} : null,
    error: studio.error,
  };

  const ready = useReportReady([gaps, studioSlice]);

  return {
    gaps: gaps.data,
    gapsLoading: gaps.loading,
    gapsError: gaps.error,
    ideas: studio.ideas,
    history: studio.history,
    studioLoading: studio.loading,
    studioError: studio.error,
    ready,
  };
}
