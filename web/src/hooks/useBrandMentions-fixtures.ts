import type {
  AggregatedBrand, BrandAppearance, BrandMentionsResponse
} from '../types';
import {
  createEndpointMockFetch, type EndpointMockFetchOptions 
} from '../test/fetchResponses';

/** One summary brand: first-party, named by OpenAI only, with no appearances unless overridden. */
export function buildAggregatedBrand(overrides: Partial<AggregatedBrand> = {}): AggregatedBrand {
  return {
    name: 'TestBrand',
    parent_company: null,
    provider_count: 1,
    total_mentions: 1,
    best_rank: 1,
    overall_rank: 1,
    aggregate_score: 0.5,
    classification: 'first_party',
    providers: ['openai'],
    provider_ranks: { openai: 1 },
    appearances: [],
    appearance_count: 0,
    sentiment_counts: {},
    ...overrides,
  };
}

/** One positive OpenAI appearance at rank 1 for the Coruña spa question, unless overridden. */
export function buildBrandAppearance(overrides: Partial<BrandAppearance> = {}): BrandAppearance {
  return {
    keyword: 'hotel coruna spa',
    provider: 'openai',
    model: 'gpt-5-mini',
    rank: 1,
    mention_count: 1,
    first_position: 10,
    sentiment: 'positive',
    ...overrides,
  };
}

/** The brand counts of a summary listing one first-party brand and one competitor, all of them. */
export const ONE_BRAND_ONE_COMPETITOR = {
  total_unique_brands: 2,
  matching_brands: 2,
  brands_truncated: false,
  summary: {
    first_party_count: 1,
    competitor_count: 1,
    other_count: 0,
  },
} satisfies Partial<BrandMentionsResponse['aggregated']>;

export const mockBrandMentionsResponse: BrandMentionsResponse = {
  keyword: 'test',
  timestamp: '2026-01-24T00:00:00Z',
  available_runs: ['2026-01-24T00:00:00Z', '2026-01-10T00:00:00Z'],
  config: null,
  aggregated: {
    brands: [
      buildAggregatedBrand({
        provider_count: 2,
        total_mentions: 10,
        aggregate_score: 0.8,
        providers: ['openai', 'perplexity'],
        provider_ranks: {
          openai: 1,
          perplexity: 1,
        },
      }),
      buildAggregatedBrand({
        name: 'Competitor',
        total_mentions: 5,
        best_rank: 2,
        overall_rank: 2,
        aggregate_score: 0.6,
        classification: 'competitor',
        provider_ranks: { openai: 2 },
      }),
    ],
    ...ONE_BRAND_ONE_COMPETITOR,
  },
  by_provider: [],
};

export function createMockFetch(options: EndpointMockFetchOptions<BrandMentionsResponse> = {}) {
  return createEndpointMockFetch(mockBrandMentionsResponse, options);
}
