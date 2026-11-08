import { useEffect } from 'react';
import { useCompetitorRollup } from '../../../hooks/useCompetitorRollup';
import { useReportReady } from '../layout/useReportReady';
import type { CompetitorRollup } from '../../../api/reports';
import type { ReportScope } from '../../../types';
import {
  ALL_SCOPE, decodeReportScope, encodeReportScope
} from '../../ui/reportScope';

/**
 * Composes the single backend slice that powers the Competitor Gap
 * report. Re-fires the fetch whenever the selected competitor changes
 * so navigating between competitors via the selector dropdown reloads
 * the rollup automatically.
 *
 * The `competitor` argument is `null` when the report is in its
 * "no selection" state — the hook short-circuits the fetch in that
 * case so we don't spin up a network call until the user picks a
 * target.
 */
export function useCompetitorGap(competitor: string | null, scope: ReportScope = ALL_SCOPE) {
  const rollup = useCompetitorRollup();
  const { fetchCompetitorRollup } = rollup;
  // Keyed on the encoded scope so a caller rebuilding the object each render keeps the same fetch.
  const scopeKey = encodeReportScope(scope);

  useEffect(() => {
    if (competitor) {
      fetchCompetitorRollup(competitor, decodeReportScope(scopeKey));
    }
  }, [competitor, scopeKey, fetchCompetitorRollup]);

  const currentRollup: CompetitorRollup | null = rollup.data?.rollup ?? null;

  // When the selected competitor is unset we don't fetch, so the slice
  // is trivially "ready" — gating only matters once a target is picked.
  const slice = competitor
    ? rollup
    : {
      loading: false,
      data: {},
      error: null 
    };
  const ready = useReportReady([slice]);

  return {
    rollup: currentRollup,
    keywordsAnalyzed: rollup.data?.keywords_analyzed ?? 0,
    /** The whole answer, for its coverage and source fields. */
    response: rollup.data,
    /** The request the rollup answered: the outranked keywords load their next pages with it. */
    request: rollup.request,
    loading: rollup.loading,
    error: rollup.error,
    computing: rollup.computing,
    ready,
  };
}
