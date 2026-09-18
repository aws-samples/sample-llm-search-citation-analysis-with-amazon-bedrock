import { useEffect } from 'react';
import { useVisibilityMetrics } from '../../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../../hooks/useHistoricalTrends';
import { useReportReady } from '../layout/useReportReady';

/**
 * Brand Visibility data composition.
 *
 * Two modes:
 *   - per-keyword (`keyword` provided): fetches `/visibility?keyword=...` and
 *     `/trends?keyword=...` for the full per-keyword breakdown + history.
 *   - all-keywords (`keyword === null`): fetches `/trends` (no keyword) which
 *     returns `keyword_trends[]` and `overall` aggregates server-side. Skips
 *     the per-keyword visibility call to avoid N+1 fan-out across many
 *     keywords; the all-keywords view focuses on rank movement and trend
 *     direction rather than per-brand SOV detail.
 *
 * When the aggregator endpoint (`GET /reports/overview`) ships in a later
 * PR, the all-keywords mode will switch to it for richer first-party-only
 * aggregates. Today's `/trends` summary covers improving/declining counts
 * and average score, which is enough for the v1 of this report.
 */
export function useBrandVisibilityReport(keyword: string | null) {
  const visibility = useVisibilityMetrics();
  const trends = useHistoricalTrends();

  const { fetchVisibilityMetrics } = visibility;
  const { fetchHistoricalTrends } = trends;

  useEffect(() => {
    if (keyword) {
      fetchVisibilityMetrics(keyword);
      fetchHistoricalTrends(keyword, 'day', 30);
    } else {
      fetchHistoricalTrends(undefined, 'day', 30);
    }
  }, [keyword, fetchVisibilityMetrics, fetchHistoricalTrends]);

  // The visibility slice is "settled" trivially in all-keywords mode — we
  // simply don't fetch it. Treating it as already resolved keeps the
  // ready-aggregation logic uniform across modes.
  const visibilitySlice = keyword
    ? visibility
    : {
      loading: false,
      data: {},
      error: null 
    };

  const ready = useReportReady([visibilitySlice, trends]);

  return {
    keyword,
    visibility: keyword ? visibility.data : null,
    visibilityLoading: visibility.loading,
    visibilityError: visibility.error,
    trends: trends.data,
    trendsLoading: trends.loading,
    trendsError: trends.error,
    ready,
  };
}
