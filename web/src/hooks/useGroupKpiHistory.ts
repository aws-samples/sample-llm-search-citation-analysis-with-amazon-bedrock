import { ApiRequestError } from '../infrastructure';
import type { ReportScope } from '../types';
import {
  isGroupKpiHistoryResponse, type GroupKpiHistoryResponse
} from '../types/domain/groupKpiHistory';
import { reportScopeParams } from '../components/ui/reportScope';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';

/** The error a non-OK status becomes; its message is what a 4xx refusal shows the reader. */
export const buildHttpError = (status: number) => new ApiRequestError('Failed to fetch the group KPI history', status);

const groupKpiHistoryEndpoint = {
  errorContext: 'visibility',
  // Stryker disable next-line StringLiteral: console context only
  logMessage: '[groupKpiHistory] Error fetching group KPI history:',
  isValidResponse: (data: unknown): data is GroupKpiHistoryResponse => isGroupKpiHistoryResponse(data),
  createHttpError: buildHttpError,
  createResponseError: (message: string) => new ApiRequestError(message),
  buildRequest: (scope: ReportScope, days: number) => ({
    path: '/reports/group-kpis',
    params: new URLSearchParams({
      ...reportScopeParams(scope),
      days: days.toString(),
    }),
  }),
};

/**
 * Every analysis run of a keyword group in the last `days` days, with its
 * citation rate, share of voice and prominence (`GET /reports/group-kpis`).
 */
export function useGroupKpiHistory() {
  const {
    data, loading, error, fetchData: fetchGroupKpiHistory
  } = useAnalysisEndpoint(groupKpiHistoryEndpoint);

  return {
    data,
    loading,
    error,
    fetchGroupKpiHistory,
  };
}
