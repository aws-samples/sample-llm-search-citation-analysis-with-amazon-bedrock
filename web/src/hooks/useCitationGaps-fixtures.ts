import { vi } from 'vitest';
import type { CitationGapsResponse } from '../types';

export function setupCitationGapsConsoleErrorMock() {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
}

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
    },
  ],
  covered_sources: [],
  domain_summary: [],
  summary: {
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
