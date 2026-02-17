import { vi } from 'vitest';

export const mockStats = {
  total_searches: 100,
  total_citations: 500,
  total_crawled: 250,
  unique_keywords: 25,
};

export const mockCitations = {
  provider_stats: [{
    provider: 'openai',
    citation_count: 100 
  }],
  brand_stats: [{
    brand: 'TestBrand',
    mention_count: 50 
  }],
  top_urls: [{
    url: 'https://example.com',
    citation_count: 10,
    keyword_count: 5 
  }],
};

export const mockSearches = [
  {
    keyword: 'test',
    provider: 'openai',
    timestamp: '2024-01-01' 
  },
];

export const mockKeywords = [
  {
    keyword: 'test keyword',
    created_at: '2024-01-01' 
  },
];

export function createMockFetch(overrides: {
  stats?: unknown;
  citations?: unknown;
  searches?: unknown;
  keywords?: unknown;
  shouldFail?: boolean;
  failStatus?: number;
} = {}) {
  return vi.fn().mockImplementation((url: string) => {
    if (overrides.shouldFail) {
      return Promise.resolve({
        ok: false,
        status: overrides.failStatus ?? 500,
      });
    }

    if (url.includes('/stats')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(overrides.stats ?? mockStats),
      });
    }
    if (url.includes('/citations')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(overrides.citations ?? mockCitations),
      });
    }
    if (url.includes('/searches')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ searches: overrides.searches ?? mockSearches }),
      });
    }
    if (url.includes('/keywords')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ keywords: overrides.keywords ?? mockKeywords }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}) 
    });
  });
}
