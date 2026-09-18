import { useEffect } from 'react';
import { useVisibilityMetrics } from '../../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../../hooks/useHistoricalTrends';
import { useReportReady } from '../layout/useReportReady';
import type { ReportScope } from '../../../types';
import { isGroupVisibilityResponse } from '../../../types/domain/visibility';
import {
  decodeReportScope, encodeReportScope
} from '../../ui/reportScope';

/**
 * Brand Visibility data composition.
 *
 * Two modes:
 *   - per-keyword (`scope.kind === 'keyword'`): fetches `/visibility?keyword=...`
 *     and `/trends?keyword=...` for the full per-keyword breakdown + history.
 *   - cross-keyword (`all` or a keyword `group`): fetches `/trends` for that
 *     scope, which returns `keyword_trends[]`, `overall` aggregates and the
 *     group series (`trend_data`) server-side. Skips the per-keyword
 *     visibility call to avoid N+1 fan-out; the cross-keyword view focuses on
 *     rank movement and trend direction rather than per-brand SOV detail.
 */
export function useBrandVisibilityReport(scope: ReportScope) {
  const visibility = useVisibilityMetrics();
  const trends = useHistoricalTrends();

  const { fetchVisibilityMetrics } = visibility;
  const { fetchHistoricalTrends } = trends;
  const scopeKey = encodeReportScope(scope);
  const isKeyword = scope.kind === 'keyword';

  useEffect(() => {
    const current = decodeReportScope(scopeKey);
    if (current.kind === 'keyword') {
      fetchVisibilityMetrics(current);
    }
    fetchHistoricalTrends(current, 'day', 30);
  }, [scopeKey, fetchVisibilityMetrics, fetchHistoricalTrends]);

  // The visibility slice is "settled" trivially in cross-keyword mode — we
  // simply don't fetch it. Treating it as already resolved keeps the
  // ready-aggregation logic uniform across modes.
  const visibilitySlice = isKeyword
    ? visibility
    : {
      loading: false,
      data: {},
      error: null 
    };

  const ready = useReportReady([visibilitySlice, trends]);
  const keywordVisibility = visibility.data && !isGroupVisibilityResponse(visibility.data) ? visibility.data : null;

  return {
    scope,
    keyword: isKeyword ? scope.keyword : null,
    visibility: isKeyword ? keywordVisibility : null,
    visibilityLoading: visibility.loading,
    visibilityError: visibility.error,
    trends: trends.data,
    trendsLoading: trends.loading,
    trendsError: trends.error,
    ready,
  };
}
