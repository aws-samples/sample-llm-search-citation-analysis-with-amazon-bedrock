import { useEffect } from 'react';
import type {
  BrandMentionsResponse, ReportScope
} from '../types';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';
import {
  decodeReportScope, encodeReportScope, reportScopeParams
} from '../components/ui/reportScope';
import {
  apiRequestErrors, useAnalysisEndpoint
} from './useAnalysisEndpoint';

/** The `/brand-mentions` answer: the aggregate and the runs the scope can be read at. */
export function isBrandMentionsResponse(data: unknown): data is BrandMentionsResponse {
  return typeof data === 'object'
    && data !== null
    && 'aggregated' in data
    && 'available_runs' in data
    && Array.isArray(data.available_runs);
}

/** The server-side filters of `/brand-mentions`, keyed by query parameter; `null` leaves one out. */
type BrandMentionsFilters = Record<'classification' | 'query_prompt_id' | 'timestamp', string | null>;

const brandMentionsEndpoint = {
  errorContext: 'brands',
  logMessage: '[brands] Error fetching brand mentions:',
  isValidResponse: isBrandMentionsResponse,
  ...apiRequestErrors('Failed to fetch brand mentions'),
  // This endpoint never checked for `{error}` bodies; its type guard rejects
  // them as an invalid format instead. Kept as-is to preserve the hook's
  // observable error messages.
  rejectBackendErrorBody: false,
  buildRequest: (scope: ReportScope, marketId: string | null, filters: BrandMentionsFilters) => {
    const params = new URLSearchParams(reportScopeParams(scope, marketId));
    for (const [name, value] of Object.entries(filters)) {
      if (value) params.append(name, value);
    }
    return {
      path: '/brand-mentions',
      params,
    };
  },
};

/**
 * Fetch brand mentions for one report scope and optional server-side filters.
 * Fetched again whenever the scope, the header's market or a filter changes;
 * a `null` scope clears the answer and drops any request in flight.
 */
export const useBrandMentions = (
  scope: ReportScope | null,
  classificationFilter: string | null = null,
  queryPromptId: string | null = null,
  selectedTimestamp: string | null = null
) => {
  const {
    data, loading, error, fetchData, reset
  } = useAnalysisEndpoint(brandMentionsEndpoint);
  // The scope object is rebuilt by callers on every render; key the effect on
  // its encoded form so a same-value scope does not refetch.
  const scopeKey = scope === null ? null : encodeReportScope(scope);
  const marketId = useSelectedMarketId();

  useEffect(() => {
    if (scopeKey === null) {
      reset();
      return;
    }
    void fetchData(decodeReportScope(scopeKey), marketId, {
      classification: classificationFilter,
      query_prompt_id: queryPromptId,
      timestamp: selectedTimestamp,
    });
  }, [fetchData, reset, scopeKey, marketId, classificationFilter, queryPromptId, selectedTimestamp]);

  return {
    data,
    loading,
    error,
  };
};
