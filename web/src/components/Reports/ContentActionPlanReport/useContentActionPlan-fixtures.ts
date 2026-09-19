import { vi } from 'vitest';
import type { useCitationGaps } from '../../../hooks/useCitationGaps';
import type { useContentStudio } from '../../../hooks/useContentStudio';
import type {
  CitationGapsResponse,
  ContentIdea,
  ContentStudioHistory,
} from '../../../types';

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
  return {
    ideas: Array.from({ length: ideaCount }, (_, i) => buildIdea(`idea-${i}`)),
    history: Array.from({ length: briefCount }, (_, i) => buildGeneratedBrief(`brief-${i}`)),
    loading,
    fetchIdeas,
    fetchHistory,
    error: null,
    unviewedCount: 0,
    generating: false,
    generateContent: vi.fn(),
    markViewed: vi.fn(),
    deleteContent: vi.fn(),
    refreshGeneratingItems: vi.fn(),
  };
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
  return {
    gaps: [],
    covered_sources: [],
    domain_summary: [],
    summary: {
      total_sources: 1,
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
        gap_type: 'competitor_only',
        priority: 'high',
        keyword: 'trail running shoes',
      },
    ],
    total_gaps: 1,
    total_high_priority: 1,
  };
}

function buildIdea(id: string): ContentIdea {
  return {
    id,
    type: 'provider_gap',
    priority: 'medium',
    title: `Idea ${id}`,
    description: 'Cover the trail running angle',
    keyword: 'trail running shoes',
    source: 'content-studio',
    actionable: true,
  };
}

function buildGeneratedBrief(id: string): ContentStudioHistory {
  return {
    id,
    keyword: 'trail running shoes',
    idea_type: 'provider_gap',
    idea_title: `Brief ${id}`,
    content_angle: 'differentiation',
    generated_content: {
      title: `Brief ${id}`,
      meta_description: 'Why trail shoes differ from road shoes',
      body: 'Generated body',
      suggested_headings: ['Grip', 'Protection'],
      key_points: ['Lug depth', 'Rock plate'],
    },
    raw_content: 'Generated body',
    competitor_sources_used: 1,
    status: 'generated',
    viewed: false,
    created_at: '2026-05-10T09:00:00Z',
    updated_at: '2026-05-10T09:00:00Z',
  };
}
