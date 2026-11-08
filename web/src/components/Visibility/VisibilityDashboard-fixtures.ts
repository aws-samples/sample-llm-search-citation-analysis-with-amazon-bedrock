import { vi } from 'vitest';
import {
  scopedHookState, type ScopedHookStateOverrides
} from '../../test/scopedHookState';
import type {
  HistoricalTrendsResponse, PersonaRankingsResponse, VisibilityResponse
} from '../../types';
import type { useVisibilityMetrics } from '../../hooks/useVisibilityMetrics';
import type { useHistoricalTrends } from '../../hooks/useHistoricalTrends';
import type { usePersonaRankings } from '../../hooks/usePersonaRankings';

/** What `useVisibilityMetrics` returns with `data`, idle and error-free unless overridden. */
export function buildVisibilityHookResult(
  data: VisibilityResponse | null,
  overrides: ScopedHookStateOverrides = {},
): ReturnType<typeof useVisibilityMetrics> {
  return {
    data,
    ...scopedHookState(overrides),
    fetchVisibilityMetrics: vi.fn(),
  };
}

/** What `useHistoricalTrends` returns with `data`, idle and error-free unless overridden. */
export function buildTrendsHookResult(
  data: HistoricalTrendsResponse | null,
  overrides: ScopedHookStateOverrides = {},
): ReturnType<typeof useHistoricalTrends> {
  return {
    data,
    ...scopedHookState(overrides),
    fetchHistoricalTrends: vi.fn(),
  };
}

/** What `usePersonaRankings` returns with `data`, idle and error-free. */
export function buildPersonaRankingsHookResult(data: PersonaRankingsResponse | null): ReturnType<typeof usePersonaRankings> {
  return {
    data,
    loading: false,
    error: null,
    fetchPersonaRankings: vi.fn(),
  };
}

/** Rankings of "hotels" by a single persona: too few to compare, so the chart says so instead of drawing. */
export const SINGLE_PERSONA_RANKINGS: PersonaRankingsResponse = {
  keyword: 'hotels',
  personas: [{
    persona_name: 'Business traveller',
    brands: [{
      rank: 1,
      classification: 'first_party',
    }],
  }],
  cross_persona_summary: { brands: [] },
};

/** What the persona comparison says when it has too few personas to compare. */
export const TOO_FEW_PERSONAS = 'At least two personas are needed for comparison.';
