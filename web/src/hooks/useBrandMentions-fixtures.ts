import type {
  AggregatedBrand, BrandMentionsResponse
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
    total_unique_brands: 2,
    matching_brands: 2,
    brands_truncated: false,
    summary: {
      first_party_count: 1,
      competitor_count: 1,
      other_count: 0,
    },
  },
  by_provider: [],
};

export function createMockFetch(options: EndpointMockFetchOptions<BrandMentionsResponse> = {}) {
  return createEndpointMockFetch(mockBrandMentionsResponse, options);
}
