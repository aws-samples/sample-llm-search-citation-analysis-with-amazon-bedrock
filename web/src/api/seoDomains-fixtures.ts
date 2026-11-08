/**
 * Domain Overview and SEO recommendation payloads for the specs of `./seoDomains`,
 * `./seoDomainsDecoders`, the Domain Overview page and the SEO vs GEO report.
 * Fictional domains only: you are `example.com`, the competitor is `acme.example.org`.
 */
import type {
  DomainKeywordsResponse,
  DomainOverviewResponse,
  DomainPagesResponse,
  DomainSnapshotsResponse,
  RankedKeywordRow,
  SeoInsightsResponse,
  SeoRecommendation,
  SerpCompetitorsResponse,
  TakeSnapshotResponse,
} from '../types/api/seoDomains';
import type {
  SeoExportAnswer, SeoExportPricing
} from '../types/api/seo';

/** The answer to an Admin's snapshot start. */
export const SNAPSHOT_STARTED: TakeSnapshotResponse = {
  domain: 'example.com',
  market_id: 'global',
  execution: 'manual-abc',
};

const TARGET = {
  target: 'example.com',
  hostname: 'example.com',
  scope: 'subdomains',
  path: '',
  market_id: 'global',
} satisfies Pick<DomainOverviewResponse, 'target' | 'hostname' | 'scope' | 'path' | 'market_id'>;

const PAID = {
  cached: false,
  fetched_at: '2026-10-21T09:00:00Z',
} satisfies Pick<DomainOverviewResponse, 'cached' | 'fetched_at'>;

/** The `export` block of a Labs list answer: `labs_usd` = 0.012 a request + 0.00012 a row. */
export const LABS_EXPORT: SeoExportPricing = {
  max_rows: 10_000,
  rows_per_request: 1000,
  request_usd: 0.012,
  row_usd: 0.00012,
  cache_hours: 12,
};

/** A page answer of a Labs list: no export window, and its export pricing. */
const PAGE_ANSWER = {
  offset: null,
  limit: null,
  export: LABS_EXPORT,
} satisfies SeoExportAnswer;

export function buildDomainOverview(overrides: Partial<DomainOverviewResponse> = {}): DomainOverviewResponse {
  return {
    ...TARGET,
    ...PAID,
    domain_wide: false,
    organic_keywords: 1520,
    estimated_traffic: 8451,
    traffic_cost: 12034.57,
    position_buckets: [
      {
        label: '1',
        keywords: 10,
      },
      {
        label: '2-3',
        keywords: 20,
      },
    ],
    has_data: true,
    ...overrides,
  };
}

export function buildRankedKeyword(overrides: Partial<RankedKeywordRow> = {}): RankedKeywordRow {
  return {
    keyword: 'cheap flights',
    position: 4,
    organic_position: 3,
    search_volume: 2400,
    etv: 120.5,
    cpc: 1.25,
    keyword_difficulty: 37,
    url: 'https://example.com/flights',
    relative_url: '/flights',
    intent: 'commercial',
    ...overrides,
  };
}

export function buildDomainKeywords(overrides: Partial<DomainKeywordsResponse> = {}): DomainKeywordsResponse {
  return {
    ...TARGET,
    ...PAID,
    ...PAGE_ANSWER,
    page: 1,
    page_size: 50,
    total_count: 120,
    has_more: true,
    items: [buildRankedKeyword()],
    ...overrides,
  };
}

export function buildDomainPages(overrides: Partial<DomainPagesResponse> = {}): DomainPagesResponse {
  return {
    ...TARGET,
    ...PAID,
    ...PAGE_ANSWER,
    page: 1,
    page_size: 50,
    total_count: 1,
    has_more: false,
    items: [{
      url: 'https://example.com/blog/a',
      relative_url: '/blog/a',
      etv: 12.5,
      keywords: 4,
    }],
    ...overrides,
  };
}

export function buildSerpCompetitors(overrides: Partial<SerpCompetitorsResponse> = {}): SerpCompetitorsResponse {
  return {
    ...PAID,
    market_id: 'global',
    keywords_count: 1,
    items: [{
      domain: 'acme.example.org',
      avg_position: 3.5,
      median_position: 3,
      visibility: 0.42,
      etv: 640,
      keywords_count: 1,
    }],
    ...overrides,
  };
}

export function buildDomainSnapshots(overrides: Partial<DomainSnapshotsResponse> = {}): DomainSnapshotsResponse {
  return {
    domain: 'example.com',
    market_id: 'global',
    source: 'dataforseo_labs',
    estimated: true,
    snapshots: [{
      domain: 'example.com',
      market_id: 'global',
      snapshot_at: '2026-10-19T04:00:00Z',
      organic_keywords: 1520,
      estimated_traffic: 8451,
      traffic_cost: 12034.57,
      position_buckets: [],
      keywords_stored: 1000,
    }],
    ...overrides,
  };
}

export function buildSeoRecommendation(overrides: Partial<SeoRecommendation> = {}): SeoRecommendation {
  return {
    id: 'a1b2c3d4e5f60718',
    type: 'ai_gap',
    priority: 'medium',
    title: 'Ranks on Google but AI answers rarely name you',
    description: 'On 2 keywords you rank in Google\'s top 10, but fewer than half of the AI answers name your brand.',
    action: 'Get your brand mentioned on the sources AI engines cite for these topics.',
    keywords: ['cheap flights', 'flight deals'],
    impact: '3,400 monthly searches across these keywords',
    status: 'new',
    ...overrides,
  };
}

export function buildSeoInsights(overrides: Partial<SeoInsightsResponse> = {}): SeoInsightsResponse {
  return {
    market_id: 'global',
    group_id: null,
    generated_at: '2026-10-21T09:00:00Z',
    recommendations: [buildSeoRecommendation()],
    total_count: 1,
    ...overrides,
  };
}
