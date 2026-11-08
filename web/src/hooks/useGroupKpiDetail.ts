import {
  useEffect, useMemo
} from 'react';
import type { ReportScope } from '../types';
import {
  isGroupKeywordRunsPage, isGroupRunDriversPage, type GroupKeywordRunsPage, type GroupRunChange, type GroupRunDriver, type GroupRunDriversPage,
  type KeywordRun, type KeywordRunHistory
} from '../types/domain/groupKpiHistory';
import {
  useAppendedPages, type AppendedPages, type PageReader
} from './useAppendedPages';
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

const pageToken = (page: { readonly next_token: string | null }): string | null => page.next_token;

/** The runs of `keyword` on each `view=keywords&detail_keyword=` page. */
function keywordRunsReader(keyword: string | null): PageReader<GroupKeywordRunsPage, KeywordRun> {
  return {
    isPage: isGroupKeywordRunsPage,
    itemsOf: (page) => page.keywords.find((entry) => entry.keyword === keyword)?.runs ?? [],
    tokenOf: pageToken,
  };
}

/** The drivers of `run` on each `view=drivers` page. */
function driversReader(run: string): PageReader<GroupRunDriversPage, GroupRunDriver> {
  return {
    isPage: isGroupRunDriversPage,
    itemsOf: (page) => page.changes.find((entry) => entry.timestamp === run)?.drivers ?? [],
    tokenOf: pageToken,
  };
}

/** Oldest run first, each run once: the first page's runs and the older pages' (2.45.0 wave 5). */
function mergeRuns(first: readonly KeywordRun[], more: readonly KeywordRun[]): KeywordRun[] {
  const byTimestamp = new Map([...first, ...more].map((run) => [run.timestamp, run]));
  return [...byTimestamp.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

/**
 * The runs of one keyword of a group over the last `days` days
 * (`view=keywords&detail_keyword=`), in the header's market; nothing is
 * read while `keyword` is `null`.
 */
export function useKeywordRuns(scope: ReportScope, days: number, keyword: string | null): {
  history: KeywordRunHistory | null;
  loading: boolean;
  error: string | null;
  more: AppendedPages<KeywordRun>;
} {
  const {
    data, loading, error, request, fetchData, reset
  } = useAnalysisEndpoint(keywordRunsEndpoint);
  const reader = useMemo(() => keywordRunsReader(keyword), [keyword]);
  const more = useAppendedPages(data === null ? null : request, data?.next_token ?? null, reader);
  const scopeKey = encodeReportScope(scope);
  const marketId = useSelectedMarketId();

  useEffect(() => {
    if (keyword === null) {
      reset();
      return;
    }
    void fetchData(decodeReportScope(scopeKey), marketId, days, keyword);
  }, [fetchData, reset, scopeKey, marketId, days, keyword]);

  const first: KeywordRunHistory | null = data?.keywords.find((entry) => entry.keyword === keyword) ?? null;
  const history = first === null || more.items.length === 0 ? first : {
    ...first,
    runs: mergeRuns(first.runs, more.items),
  };
  return {
    history,
    loading,
    error,
    more,
  };
}

/**
 * The keywords that drove the group run `run` since its previous group run
 * (`view=drivers`, reading only those two runs), in the header's market.
 */
export function useRunDrivers(scope: ReportScope, run: string, change: GroupRunChange): {
  drivers: GroupRunDriver[] | null;
  loading: boolean;
  error: string | null;
  more: AppendedPages<GroupRunDriver>;
} {
  const {
    data, loading, error, request, fetchData
  } = useAnalysisEndpoint(runDriversEndpoint);
  const reader = useMemo(() => driversReader(run), [run]);
  const more = useAppendedPages(data === null ? null : request, data?.next_token ?? null, reader);
  const scopeKey = encodeReportScope(scope);
  const marketId = useSelectedMarketId();
  const previousRun = change.previous_timestamp;

  useEffect(() => {
    void fetchData(decodeReportScope(scopeKey), marketId, previousRun, run);
  }, [fetchData, scopeKey, marketId, previousRun, run]);

  const first = data?.changes.find((entry) => entry.timestamp === run)?.drivers ?? null;
  const drivers = first === null ? null : [...first, ...more.items];
  return {
    drivers,
    loading,
    error,
    more,
  };
}
