/**
 * `GET /api/seo/seo-geo` answers and `useSeoGeo` states for the SEO vs GEO
 * report, its sections, chart and custom report blocks.
 */
import { buildSeoGeoResponse as buildApiSeoGeoResponse } from '../api/seo-fixtures';
import type {
  SeoGeoResponse, SeoGeoRow, TrafficShareEntry
} from '../types/api/seo';
import type { SeoGeoState } from './useSeoGeo';

/** A keyword in Google's top 10 that the AI answers rarely name. */
export function buildSeoGeoRow(overrides: Partial<SeoGeoRow> = {}): SeoGeoRow {
  return {
    keyword_id: 'kw-flights-geneva',
    keyword: 'cheap flights geneva',
    search_volume: 12100,
    organic_position: 3,
    ranked_position: null,
    organic_position_source: 'serp_top10',
    estimated_traffic: null,
    competitor_positions: { Acme: 1 },
    ai_overview_shown: true,
    ai_overview_cites_you: false,
    ai_overview_cited_competitors: [],
    ai_mention_rate: 20,
    answers: 5,
    citation_overlap: 40,
    quadrant: 'ai_gap',
    last_run: '2026-10-20T08:00:00Z',
    ...overrides,
  };
}

/** A results page was read but none of your domains is in its top 10. */
export const BEYOND_TOP_ROW = buildSeoGeoRow({
  keyword_id: 'kw-example-air-lounge',
  keyword: 'example air lounge access',
  search_volume: 880,
  organic_position: null,
  ranked_position: 14,
  organic_position_source: 'ranked_keywords',
  estimated_traffic: 35.4,
  ai_mention_rate: 80,
  quadrant: 'seo_gap',
});

/** No Google AI Overviews result yet. */
export const NO_DATA_ROW = buildSeoGeoRow({
  keyword_id: 'kw-example-air-baggage',
  keyword: 'example air baggage',
  search_volume: null,
  organic_position: null,
  competitor_positions: { Acme: null },
  organic_position_source: null,
  ai_overview_shown: null,
  ai_overview_cites_you: null,
  ai_mention_rate: null,
  answers: 0,
  citation_overlap: null,
  quadrant: 'no_data',
  last_run: null,
});

/** You hold 40% of the scope's estimated traffic and half the AI mentions; Acme the rest of the traffic. */
export const TRAFFIC_COMPARISON: readonly TrafficShareEntry[] = [
  {
    name: 'You',
    owned: true,
    estimated_traffic: 400,
    traffic_share: 40,
    share_of_voice: 50,
  },
  {
    name: 'Acme',
    owned: false,
    estimated_traffic: 600,
    traffic_share: 60,
    share_of_voice: 25,
  },
];

export function buildSeoGeoResponse(overrides: Partial<SeoGeoResponse> = {}): SeoGeoResponse {
  return buildApiSeoGeoResponse({
    generated_at: '2026-10-21T09:00:00Z',
    summary: {
      both_strong: 4,
      ai_gap: 3,
      seo_gap: 2,
      both_weak: 1,
      no_data: 7,
    },
    rows: [buildSeoGeoRow(), BEYOND_TOP_ROW, NO_DATA_ROW],
    traffic_comparison: [...TRAFFIC_COMPARISON],
    traffic_snapshot_at: '2026-10-19T04:00:00Z',
    ...overrides,
  });
}

export function buildSeoGeoState(overrides: Partial<SeoGeoState> = {}): SeoGeoState {
  return {
    data: buildSeoGeoResponse(),
    loading: false,
    error: null,
    notConfigured: false,
    ready: true,
    ...overrides,
  };
}

export const NOT_DEPLOYED_STATE = buildSeoGeoState({
  data: null,
  notConfigured: true,
});
