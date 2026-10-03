import type {
  HistoricalTrendsResponse, PeriodType, ReportScope
} from '../types';
import { isRecord } from '../types/domain/keywordDecoders';
import { reportScopeParams } from '../components/ui/reportScope';
import {
  apiRequestErrors, isAnalysisPayload, useAnalysisEndpoint 
} from './useAnalysisEndpoint';

/** The one `/trends` shape of every scope: the KPIs per period, the latest standing and each keyword's move. */
function isHistoricalTrendsResponse(value: unknown): value is HistoricalTrendsResponse {
  return isAnalysisPayload(value)
    && isRecord(value.scope)
    && Array.isArray(value.trend_data)
    && isRecord(value.latest)
    && Array.isArray(value.keyword_trends);
}

const historicalTrendsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[historicalTrends] Error fetching trends:',
  isValidResponse: isHistoricalTrendsResponse,
  ...apiRequestErrors('Failed to fetch historical trends'),
  buildRequest: (
    scope: ReportScope,
    period: PeriodType = 'day',
    days = 30
  ) => {
    const params = new URLSearchParams({
      ...reportScopeParams(scope),
      period,
      days: days.toString(),
    });
    return {
      path: '/trends',
      params,
    };
  },
};

/**
 * Historical KPIs of a report scope (one keyword, a keyword group or every
 * keyword), per day, ISO week or month.
 *
 * @returns Object containing:
 * - `data` - every KPI per period (`trend_data`), the latest standing, its
 *   change since the previous period and each keyword's move
 * - `loading` - Whether data is being fetched
 * - `error` - Error message if fetch failed
 * - `fetchHistoricalTrends` - Function to fetch trends with parameters
 *
 * @example
 * ```tsx
 * const { data, fetchHistoricalTrends } = useHistoricalTrends();
 *
 * useEffect(() => {
 *   // 30 days of daily KPIs for a keyword
 *   fetchHistoricalTrends({ kind: 'keyword', keyword: 'best hotels' }, 'day', 30);
 *   // ...or of a keyword group
 *   fetchHistoricalTrends({ kind: 'group', groupId }, 'day', 90);
 * }, []);
 * ```
 */
export function useHistoricalTrends() {
  const {
    data, loading, error, fetchData: fetchHistoricalTrends
  } = useAnalysisEndpoint(historicalTrendsEndpoint);

  return {
    data,
    loading,
    error,
    fetchHistoricalTrends
  };
}
