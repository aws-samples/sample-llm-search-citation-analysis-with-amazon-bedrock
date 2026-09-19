import type { BrandMentionsResponse } from '../types';
import {
  createEndpointMockFetch, type EndpointMockFetchOptions 
} from '../test/fetchResponses';

export const mockBrandMentionsResponse: BrandMentionsResponse = {
  keyword: 'test',
  timestamp: '2026-01-24T00:00:00Z',
  available_runs: ['2026-01-24T00:00:00Z', '2026-01-10T00:00:00Z'],
  config: null,
  aggregated: {
    brands: [
      {
        name: 'TestBrand',
        parent_company: null,
        provider_count: 2,
        total_mentions: 10,
        best_rank: 1,
        overall_rank: 1,
        aggregate_score: 0.8,
        classification: 'first_party',
        providers: ['openai', 'perplexity'],
        appearances: [],
      },
      {
        name: 'Competitor',
        parent_company: null,
        provider_count: 1,
        total_mentions: 5,
        best_rank: 2,
        overall_rank: 2,
        aggregate_score: 0.6,
        classification: 'competitor',
        providers: ['openai'],
        appearances: [],
      },
    ],
    total_unique_brands: 2,
    first_party_brands: [],
    competitor_brands: [],
    other_brands: [],
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
