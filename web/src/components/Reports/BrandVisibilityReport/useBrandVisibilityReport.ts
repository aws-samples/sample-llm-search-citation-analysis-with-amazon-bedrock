import { useEffect } from 'react';
import { useVisibilityMetrics } from '../../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../../hooks/useHistoricalTrends';
import { useGroupKpiHistory } from '../../../hooks/useGroupKpiHistory';
import { useReportReady } from '../layout/useReportReady';
import type { ReportScope } from '../../../types';
import {
  decodeReportScope, encodeReportScope
} from '../../ui/reportScope';

/**
 * Brand Visibility data composition.
 *
 * Three modes:
 *   - per-keyword (`scope.kind === 'keyword'`): fetches `/visibility?keyword=...`
 *     (the latest run's KPIs and brand leaderboard) and `/trends?keyword=...`
 *     (the KPIs per day and the latest change).
 *   - keyword group (`group`, one hotel): fetches `/reports/group-kpis` for the
 *     last `days` days — every run's KPIs, what drove each change, and every
 *     keyword's runs.
 *   - all keywords (`all`): fetches `/trends`, which returns the pooled
 *     latest KPIs and change, `keyword_trends[]` and `overall` counts.
 */
export function useBrandVisibilityReport(scope: ReportScope, days: number) {
  const visibility = useVisibilityMetrics();
  const trends = useHistoricalTrends();
  const groupHistory = useGroupKpiHistory();

  const { fetchVisibilityMetrics } = visibility;
  const { fetchHistoricalTrends } = trends;
  const { fetchGroupKpiHistory } = groupHistory;
  const scopeKey = encodeReportScope(scope);
  const isKeyword = scope.kind === 'keyword';
  const isGroup = scope.kind === 'group';

  useEffect(() => {
    const current = decodeReportScope(scopeKey);
    if (current.kind === 'group') {
      fetchGroupKpiHistory(current, days);
      return;
    }
    if (current.kind === 'keyword') {
      fetchVisibilityMetrics(current);
    }
    fetchHistoricalTrends(current, 'day', 30);
  }, [scopeKey, days, fetchVisibilityMetrics, fetchHistoricalTrends, fetchGroupKpiHistory]);

  const ready = useReportReady(isKeyword ? [visibility, trends] : [isGroup ? groupHistory : trends]);

  return {
    scope,
    keyword: isKeyword ? scope.keyword : null,
    visibility: isKeyword ? visibility.data : null,
    visibilityLoading: visibility.loading,
    visibilityError: visibility.error,
    trends: trends.data,
    trendsLoading: trends.loading,
    trendsError: trends.error,
    groupHistory: groupHistory.data,
    groupHistoryLoading: groupHistory.loading,
    groupHistoryError: groupHistory.error,
    ready,
  };
}
