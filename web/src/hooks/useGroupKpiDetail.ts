import { useEffect } from 'react';
import type { ReportScope } from '../types';
import {
  isGroupKeywordRunsPage, isGroupRunDriversPage, type GroupRunChange, type GroupRunDriver, type KeywordRunHistory
} from '../types/domain/groupKpiHistory';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';
import {
  decodeReportScope, encodeReportScope
} from '../components/ui/reportScope';
import {
  apiRequestErrors, useAnalysisEndpoint
} from './useAnalysisEndpoint';
import { groupKpiRequest } from './useGroupKpiHistory';

const keywordRunsEndpoint = {
  errorContext: 'visibility',
  // Stryker disable next-line StringLiteral: console context only
  logMessage: '[groupKpiHistory] Error fetching a keyword\'s runs:',
  isValidResponse: isGroupKeywordRunsPage,
  ...apiRequestErrors('Failed to fetch the keyword\'s runs'),
  buildRequest: (scope: ReportScope, marketId: string | null, days: number, keyword: string) => groupKpiRequest(scope, marketId, {
    days: days.toString(),
    view: 'keywords',
    detail_keyword: keyword,
  }),
};

const runDriversEndpoint = {
  errorContext: 'visibility',
  // Stryker disable next-line StringLiteral: console context only
  logMessage: '[groupKpiHistory] Error fetching a run\'s drivers:',
  isValidResponse: isGroupRunDriversPage,
  ...apiRequestErrors('Failed to fetch what drove the change'),
  buildRequest: (scope: ReportScope, marketId: string | null, previousRun: string, run: string) => groupKpiRequest(scope, marketId, {
    view: 'drivers',
    from_run: previousRun,
    to_run: run,
  }),
};

/**
 * The runs of one keyword of a group over the last `days` days
 * (`view=keywords&detail_keyword=`), in the header's market; nothing is
 * read while `keyword` is `null`.
 */
export function useKeywordRuns(scope: ReportScope, days: number, keyword: string | null) {
  const {
    data, loading, error, fetchData, reset
  } = useAnalysisEndpoint(keywordRunsEndpoint);
  const scopeKey = encodeReportScope(scope);
  const marketId = useSelectedMarketId();

  useEffect(() => {
    if (keyword === null) {
      reset();
      return;
    }
    void fetchData(decodeReportScope(scopeKey), marketId, days, keyword);
  }, [fetchData, reset, scopeKey, marketId, days, keyword]);

  const history: KeywordRunHistory | null = data?.keywords.find((entry) => entry.keyword === keyword) ?? null;
  return {
    history,
    loading,
    error,
  };
}

/**
 * The keywords that drove the group run `run` since its previous group run
 * (`view=drivers`, reading only those two runs), in the header's market.
 */
export function useRunDrivers(scope: ReportScope, run: string, change: GroupRunChange) {
  const {
    data, loading, error, fetchData
  } = useAnalysisEndpoint(runDriversEndpoint);
  const scopeKey = encodeReportScope(scope);
  const marketId = useSelectedMarketId();
  const previousRun = change.previous_timestamp;

  useEffect(() => {
    void fetchData(decodeReportScope(scopeKey), marketId, previousRun, run);
  }, [fetchData, scopeKey, marketId, previousRun, run]);

  const drivers: GroupRunDriver[] | null = data?.changes.find((entry) => entry.timestamp === run)?.drivers ?? null;
  return {
    drivers,
    loading,
    error,
  };
}
