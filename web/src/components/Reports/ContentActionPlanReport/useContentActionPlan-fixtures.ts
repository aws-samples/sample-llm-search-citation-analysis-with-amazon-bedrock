import { buildContentStudioHookResult } from '../../ContentStudio/ContentStudioView-fixtures';
import { buildCitationGapsResponse } from '../../Insights/CitationGaps-fixtures';
import type { useCitationGaps } from '../../../hooks/useCitationGaps';
import type { useContentStudio } from '../../../hooks/useContentStudio';
import type { CitationGapsResponse } from '../../../types';
import {
  buildBrief, buildIdea
} from './sections/ContentPlanSectionProps-fixtures';

type StudioHookResult = ReturnType<typeof useContentStudio>;
type GapsHookResult = ReturnType<typeof useCitationGaps>;

interface StudioSeed {
  readonly fetchIdeas: StudioHookResult['fetchIdeas'];
  readonly fetchHistory: StudioHookResult['fetchHistory'];
  /** Number of open ideas the studio reports. */
  readonly ideaCount?: number;
  /** Number of generated briefs in the studio history. */
  readonly briefCount?: number;
  readonly loading?: boolean;
}

/**
 * Snapshot of `useContentStudio` as seen by the report hook: only the
 * presence of ideas / briefs and the loading flag matter to it, so the
 * seed speaks in counts and the fetch spies are injected by the spec.
 */
export function buildStudioSnapshot({
  fetchIdeas,
  fetchHistory,
  ideaCount = 0,
  briefCount = 0,
  loading = false,
}: StudioSeed): StudioHookResult {
  return buildContentStudioHookResult({
    ideas: Array.from({ length: ideaCount }, (_, i) => buildIdea(`idea-${i}`)),
    history: Array.from({ length: briefCount }, (_, i) => buildBrief(`brief-${i}`)),
    loading,
    fetchIdeas,
    fetchHistory,
  });
}

interface GapsSeed {
  readonly fetchCitationGaps: GapsHookResult['fetchCitationGaps'];
  readonly data?: CitationGapsResponse | null;
  readonly loading?: boolean;
  readonly error?: string | null;
}

/** Snapshot of `useCitationGaps` with the fetch spy injected by the spec. */
export function buildGapsSnapshot({
  fetchCitationGaps,
  data = null,
  loading = false,
  error = null,
}: GapsSeed): GapsHookResult {
  return {
    data,
    loading,
    error,
    fetchCitationGaps,
  };
}

/** Cross-keyword citation-gaps payload with a single top gap. */
export function buildCitationGaps(): CitationGapsResponse {
  return buildCitationGapsResponse({
    summary: {
      gap_count: 1,
      covered_count: 0,
      high_priority_gaps: 1,
      coverage_rate: 0,
    },
    top_gaps: [
      {
        url: 'https://gear-review.example/trail-shoes',
        domain: 'gear-review.example',
        citation_count: 3,
        providers: ['openai', 'perplexity'],
        provider_count: 2,
        first_party_brands: [],
        competitor_brands: ['Salomon'],
        priority: 'high',
        keyword: 'trail running shoes',
      },
    ],
    total_gaps: 1,
    total_high_priority: 1,
  });
}
