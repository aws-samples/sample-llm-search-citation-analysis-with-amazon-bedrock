/**
 * SEO API payloads for the specs of `./seo`, `./seoDecoders` and the Keyword Explorer.
 */
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import type {
  KeywordResearchResponse,
  KeywordRow,
  OrganicItem,
  SeoGeoResponse,
  SeoGeoRow,
  SerpResponse,
} from '../types/api/seo';

/** URL and parsed JSON body of the `call`-th mocked `authenticatedFetch` request. */
export function sentSeoRequest(call = 0): {
  url: unknown;
  body: unknown 
} {
  const [url, init] = mockAuthenticatedFetch.mock.calls[call];
  return {
    url,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  };
}

/** Answers every mocked `authenticatedFetch` request with `payload` as a 200 JSON response. */
export function answerSeoRequestsWith(payload: unknown): void {
  mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(payload));
}

/** `payload` without `field`, for the "missing field" specs. */
export function withoutField(payload: object, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== field));
}

export function buildKeywordRow(overrides: Partial<KeywordRow> = {}): KeywordRow {
  return {
    keyword: 'boutique hotel',
    search_volume: 1900,
    trend: [
      {
        year: 2026,
        month: 1,
        search_volume: 1600,
      },
      {
        year: 2026,
        month: 2,
        search_volume: 2100,
      },
    ],
    keyword_difficulty: 42,
    cpc: 1.25,
    competition: 0.61,
    intent: 'commercial',
    ...overrides,
  };
}

export function buildResearchResponse(overrides: Partial<KeywordResearchResponse> = {}): KeywordResearchResponse {
  return {
    keyword: 'boutique hotel',
    market_id: 'global',
    location_code: 2840,
    language_code: 'en',
    data_source: 'labs',
    source: 'auto',
    used_fallback: false,
    rows: [buildKeywordRow()],
    cached: false,
    fetched_at: '2026-09-18T09:00:00Z',
    ...overrides,
  };
}

export function buildOrganicItem(overrides: Partial<OrganicItem> = {}): OrganicItem {
  return {
    position: 1,
    rank_absolute: 2,
    url: 'https://www.example.com/hotels',
    domain: 'www.example.com',
    title: 'Example Air hotels',
    description: 'Rooms and suites.',
    ...overrides,
  };
}

export function buildSerpResponse(overrides: Partial<SerpResponse> = {}): SerpResponse {
  return {
    keyword: 'boutique hotel',
    market_id: 'global',
    depth: 20,
    items: [buildOrganicItem()],
    item_types: ['organic', 'ai_overview'],
    has_ai_overview: true,
    check_url: null,
    cached: false,
    fetched_at: '2026-09-18T09:00:00Z',
    ...overrides,
  };
}

export function buildSeoGeoRow(overrides: Partial<SeoGeoRow> = {}): SeoGeoRow {
  return {
    keyword_id: 'keyword-1',
    keyword: 'boutique hotel',
    search_volume: 1900,
    organic_position: 4,
    ranked_position: null,
    organic_position_source: 'serp_top10',
    estimated_traffic: null,
    competitor_positions: {
      Acme: 2,
      'Example Air': null,
    },
    ai_overview_shown: true,
    ai_overview_cites_you: null,
    ai_overview_cited_competitors: [],
    ai_mention_rate: 50,
    answers: 8,
    citation_overlap: null,
    quadrant: 'both_strong',
    last_run: null,
    ...overrides,
  };
}

export function buildSeoGeoResponse(overrides: Partial<SeoGeoResponse> = {}): SeoGeoResponse {
  return {
    market_id: 'global',
    group_id: null,
    generated_at: '2026-09-18T09:00:00Z',
    thresholds: {
      seo_top_position: 10,
      geo_mention_rate: 50,
    },
    summary: {
      both_strong: 1,
      ai_gap: 0,
      seo_gap: 0,
      both_weak: 0,
      no_data: 0,
    },
    rows: [buildSeoGeoRow()],
    traffic_comparison: [],
    traffic_snapshot_at: null,
    ...overrides,
  };
}
