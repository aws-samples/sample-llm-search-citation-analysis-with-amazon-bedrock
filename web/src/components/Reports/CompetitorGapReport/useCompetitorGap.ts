import { useEffect } from 'react';
import { useCompetitorRollup } from '../../../hooks/useCompetitorRollup';
import { useReportReady } from '../layout/useReportReady';
import {
  isSingleCompetitorResponse,
  type CompetitorRollup,
} from '../../../api/reports';

const DEFAULT_KEYWORD_LIMIT = 50;

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
export function useCompetitorGap(competitor: string | null) {
  const rollup = useCompetitorRollup();
  const { fetchCompetitorRollup } = rollup;

  useEffect(() => {
    if (competitor) {
      fetchCompetitorRollup(competitor, DEFAULT_KEYWORD_LIMIT);
    }
  }, [competitor, fetchCompetitorRollup]);

  // Translate the discriminated union into a single, ergonomic
  // `currentRollup` field so report sections don't have to re-narrow
  // the union themselves.
  const currentRollup: CompetitorRollup | null
    = rollup.data && isSingleCompetitorResponse(rollup.data)
      ? rollup.data.rollup
      : null;

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
    competitor,
    rollup: currentRollup,
    keywordsAnalyzed: rollup.data?.keywords_analyzed ?? 0,
    loading: rollup.loading,
    error: rollup.error,
    ready,
  };
}
