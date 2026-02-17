import { vi } from 'vitest';
import type { CitationGapsResponse } from '../types';

export const mockCitationGapsResponse: CitationGapsResponse = {
  gaps: [
    {
      url: 'https://example.com/article1',
      title: 'Best Hotels Guide',
      domain: 'example.com',
      priority: 'high',
      citation_count: 5,
      provider_count: 3,
      providers: ['openai', 'perplexity', 'gemini'],
      first_party_brands: [],
      competitor_brands: ['Marriott', 'Hilton'],
      gap_type: 'competitor_only',
    },
    {
      url: 'https://example.com/article2',
      title: 'Travel Tips',
      domain: 'example.com',
      priority: 'medium',
      citation_count: 3,
      provider_count: 2,
      providers: ['openai', 'claude'],
      first_party_brands: [],
      competitor_brands: ['Hilton'],
      gap_type: 'neutral',
    },
  ],
  covered_sources: [],
  domain_summary: [],
  summary: {
    total_sources: 2,
    gap_count: 2,
    covered_count: 0,
    high_priority_gaps: 1,
    coverage_rate: 0,
  },
};

export const mockAllKeywordsResponse: CitationGapsResponse = {
  gaps: [],
  covered_sources: [],
  domain_summary: [],
  summary: {
    total_sources: 10,
    gap_count: 8,
    covered_count: 2,
    high_priority_gaps: 3,
    coverage_rate: 0.2,
  },
  top_gaps: [
    {
      url: 'https://example.com/top',
      title: 'Top Article',
      domain: 'example.com',
      priority: 'high',
      citation_count: 10,
      provider_count: 4,
      providers: ['openai', 'perplexity', 'gemini', 'claude'],
      first_party_brands: [],
      competitor_brands: ['Marriott'],
      gap_type: 'competitor_only',
      keyword: 'best hotels',
    },
  ],
  keyword_summaries: [
    {
      keyword: 'best hotels',
      gap_count: 5,
      high_priority_gaps: 2,
      coverage_rate: 0.3,
    },
    {
      keyword: 'luxury resorts',
      gap_count: 3,
      high_priority_gaps: 1,
      coverage_rate: 0.4,
    },
  ],
};

export function createMockFetch(options: {
  response?: CitationGapsResponse;
  shouldFail?: boolean;
  failStatus?: number;
  errorResponse?: { error: string };
  invalidResponse?: boolean;
} = {}) {
  return vi.fn().mockImplementation(() => {
    if (options.shouldFail) {
      return Promise.resolve({
        ok: false,
        status: options.failStatus ?? 500,
      });
    }

    if (options.errorResponse) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.errorResponse),
      });
    }

    if (options.invalidResponse) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ invalid: 'data' }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(options.response ?? mockCitationGapsResponse),
    });
  });
}
