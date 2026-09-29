import type { useKeywordDeepDive } from './useKeywordDeepDive';
import {
  buildPeriodChange, buildTrendView, buildVisibility
} from '../layout/reportPayload-fixtures';

/** Every slice of the Deep Dive settled: `buildVisibility()` with a run change and `buildTrendView()`, the other slices empty. */
export function settledData(): ReturnType<typeof useKeywordDeepDive> {
  return {
    visibility: buildVisibility({ change: buildPeriodChange() }),
    visibilityError: null,
    visibilityLoading: false,
    trends: buildTrendView(),
    trendsError: null,
    trendsLoading: false,
    personas: null,
    personasError: null,
    personasLoading: false,
    mentions: null,
    mentionsError: null,
    mentionsLoading: false,
    gaps: null,
    gapsError: null,
    gapsLoading: false,
    recommendations: null,
    recommendationsError: null,
    recommendationsLoading: false,
    ready: true,
  };
}
