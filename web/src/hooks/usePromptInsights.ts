import { useCallback } from 'react';
import type {
  PromptInsightsResponse, ReportScope
} from '../types';
import {
  decodeReportScope, encodeReportScope, reportScopeParams
} from '../components/ui/reportScope';
import {
  fetchErrors, useAnalysisEndpoint 
} from './useAnalysisEndpoint';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';

type PromptInsightType = 'all' | 'winning' | 'losing' | 'opportunities';

function isPromptInsightsResponse(data: unknown): data is PromptInsightsResponse {
  return typeof data === 'object' && data !== null && 'total_prompts_analyzed' in data;
}

const promptInsightsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[promptInsights] Error fetching prompt insights:',
  isValidResponse: isPromptInsightsResponse,
  ...fetchErrors('PromptInsightsFetchError', 'Failed to fetch prompt insights'),
  // This endpoint never checked for `{error}` bodies; its type guard
  // rejects them as an invalid format instead. Kept as-is to preserve
  // the hook's observable error messages.
  rejectBackendErrorBody: false,
  buildRequest: (scope: ReportScope, marketId: string | null, type: PromptInsightType, limit: number) => {
    const params = new URLSearchParams({
      ...reportScopeParams(scope, marketId),
      type,
      limit: limit.toString(),
    });
    return {
      path: '/prompt-insights',
      params,
    };
  },
};

/**
 * Prompt insights of a report scope (one keyword, a keyword group or every
 * keyword): which prompts the brand wins, loses, or could win.
 * `fetchPromptInsights` is rebuilt when the scope changes, so an effect
 * listing it refetches per scope.
 */
export function usePromptInsights(scope: ReportScope) {
  const {
    data, loading, error, fetchData,
  } = useAnalysisEndpoint(promptInsightsEndpoint);
  // Keyed on the encoded scope so a caller rebuilding the object each render keeps the same fetch.
  const scopeKey = encodeReportScope(scope);
  const marketId = useSelectedMarketId();

  const fetchPromptInsights = useCallback(
    (type: PromptInsightType = 'all', limit = 20) => fetchData(decodeReportScope(scopeKey), marketId, type, limit),
    [fetchData, scopeKey, marketId],
  );

  return {
    data,
    loading,
    error,
    fetchPromptInsights,
  };
}
