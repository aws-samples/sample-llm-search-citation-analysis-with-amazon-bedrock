import { ApiRequestError } from '../infrastructure';
import type { ReportScope } from '../types';
import {
  isGroupKpiHistoryResponse, type GroupKpiHistoryResponse
} from '../types/domain/groupKpiHistory';
import { reportScopeParams } from '../components/ui/reportScope';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';
import { useMarketScopedFetch } from './useMarketScopedFetch';

/** The error a non-OK status becomes; its message is what a 4xx refusal shows the reader. */
export const buildHttpError = (status: number) => new ApiRequestError('Failed to fetch the group KPI history', status);

/** A `GET /reports/group-kpis` request: the scope in the market plus the view's own parameters. */
export function groupKpiRequest(scope: ReportScope, marketId: string | null, viewParams: Readonly<Record<string, string>>) {
  return {
    path: '/reports/group-kpis',
    params: new URLSearchParams({
      ...reportScopeParams(scope, marketId),
      ...viewParams,
    }),
  };
}

const groupKpiHistoryEndpoint = {
  errorContext: 'visibility',
  // Stryker disable next-line StringLiteral: console context only
  logMessage: '[groupKpiHistory] Error fetching group KPI history:',
  isValidResponse: (data: unknown): data is GroupKpiHistoryResponse => isGroupKpiHistoryResponse(data),
  createHttpError: buildHttpError,
  createResponseError: (message: string) => new ApiRequestError(message),
  buildRequest: (marketId: string | null, scope: ReportScope, days: number) => groupKpiRequest(scope, marketId, { days: days.toString() }),
};

/**
 * Every analysis run of a keyword group in the last `days` days, with its
 * citation rate, share of voice and prominence (`GET /reports/group-kpis`),
 * in the header's market.
 */
export function useGroupKpiHistory() {
  const {
    data, loading, error, fetchData
  } = useAnalysisEndpoint(groupKpiHistoryEndpoint);
  const fetchGroupKpiHistory = useMarketScopedFetch(fetchData);

  return {
    data,
    loading,
    error,
    fetchGroupKpiHistory,
  };
}
