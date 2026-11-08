import {
  useEffect, useMemo
} from 'react';
import { useCitationGaps } from '../../../hooks/useCitationGaps';
import { useContentStudio } from '../../../hooks/useContentStudio';
import { useEveryPage } from '../../../hooks/useEveryPage';
import { useScopedList } from '../../../hooks/useScopedList';
import {
  GAP_SUMMARIES_PAGING, isGapSummary
} from '../../../api/scopedListPagings';
import { useReportReady } from '../layout/useReportReady';
import {
  ALL_SCOPE, reportScopeParams
} from '../../ui/reportScope';
import { useSelectedMarketId } from '../../Markets/marketSelectionContext';

const CITATION_GAPS_LIMIT = 50;

type StudioState = ReturnType<typeof useContentStudio>;

/** Loads every ideas and history page; true while pages are left (a failed page stops it and shows its error). */
function useEveryStudioPage(studio: StudioState): boolean {
  const busy = studio.loading || studio.ideasLoadingMore || studio.historyLoadingMore;
  const failed = studio.error !== null;
  useEveryPage(studio.ideasHasMore ? studio.loadMoreIdeas : undefined, busy, failed);
  useEveryPage(studio.historyHasMore ? studio.loadMoreHistory : undefined, busy, failed);
  return (studio.ideasHasMore || studio.historyHasMore) && !failed;
}

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
 * targeting it." The join is client-side, so it reads every page of the three
 * lists first (2.45.0 wave 5: every keyword summary, idea and history item,
 * not the first 50 / 50 / 20); the report is ready once all are loaded.
 */
export function useContentActionPlan() {
  const gaps = useCitationGaps();
  const studio = useContentStudio();
  const marketId = useSelectedMarketId();

  const { fetchCitationGaps } = gaps;
  const {
    fetchIdeas, fetchHistory 
  } = studio;

  useEffect(() => {
    fetchCitationGaps(ALL_SCOPE, CITATION_GAPS_LIMIT);
    fetchIdeas(reportScopeParams(ALL_SCOPE, marketId));
    fetchHistory();
  }, [fetchCitationGaps, fetchIdeas, fetchHistory, marketId]);

  const summaries = useScopedList(gaps.data, gaps.request, GAP_SUMMARIES_PAGING, isGapSummary);
  useEveryPage(summaries.loadMore, summaries.loadingMore, summaries.error !== null);
  const studioPagesLeft = useEveryStudioPage(studio);

  // The answer with every keyword summary loaded so far in place of its first page.
  const { data: gapsData } = gaps;
  const { items: summaryItems } = summaries;
  const allGaps = useMemo(() => (gapsData === null || summaryItems.length === 0 ? gapsData : {
    ...gapsData,
    keyword_summaries: [...summaryItems],
  }), [gapsData, summaryItems]);

  // Re-shape the studio hook's state into a ReportDataSlice so it composes
  // with the citation-gaps slice via `useReportReady`. The studio hook tracks
  // ideas + history together under one `loading` flag, and once both arrays
  // are populated we treat them as settled.
  const studioSlice = {
    loading: studio.loading,
    data: studio.ideas.length > 0 || studio.history.length > 0 ? {} : null,
    error: studio.error,
  };

  const settled = useReportReady([gaps, studioSlice]);
  // A page that failed shows its error instead of holding the report back.
  const pagesLeft = (summaries.loadMore !== undefined && summaries.error === null) || studioPagesLeft;

  return {
    gaps: allGaps,
    gapsRequest: gaps.request,
    gapsLoading: gaps.loading,
    gapsError: gaps.error ?? summaries.error,
    ideas: studio.ideas,
    history: studio.history,
    studioLoading: studio.loading,
    studioError: studio.error,
    ready: settled && !pagesLeft,
  };
}
