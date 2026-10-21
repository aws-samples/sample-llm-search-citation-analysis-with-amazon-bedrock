import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import type {
  CitationsPage, Keyword, Search, Stats
} from '../../types';
import { TabContent } from './TabContent';

/** The dashboard's first `/citations` page: one URL listed out of the scope's 4,210. */
export const FIRST_CITATIONS_PAGE: CitationsPage = {
  provider_stats: [],
  brand_stats: [],
  top_urls: [{
    url: 'https://www.despegar.cl/vuelos',
    citation_count: 9,
  }],
  total_urls: 4210,
  total_citation_count: 18_000,
  matched_urls: 4210,
  next_token: 'page-2',
  truncated: false,
};

/** `/stats` counted from DescribeTable's item counts. */
export const APPROXIMATE_STATS: Stats = {
  total_searches: 250_000,
  total_citations: 900_000,
  total_crawled: 40_000,
  unique_keywords: 120,
  counts_approximate: true,
};

/** One row of the Recent Searches first page. */
export const RECENT_SEARCH: Search = {
  keyword: 'vuelos baratos a lima',
  provider: 'openai',
  timestamp: '2026-10-07T06:50:33Z',
};

export function buildTabContentKeyword(
  overrides: Partial<Keyword> = {}
): Keyword {
  return {
    id: 'keyword-1',
    keyword: 'Alpha keyword',
    created_at: '2026-01-01T00:00:00Z',
    status: 'active',
    group_ids: ['group-1'],
    ...overrides,
  };
}

export function buildTabContentProps(
  overrides: Partial<ComponentProps<typeof TabContent>> = {}
): ComponentProps<typeof TabContent> {
  return {
    activeTab: 'content-studio',
    stats: null,
    citations: null,
    searches: [],
    searchesNextToken: null,
    keywords: [buildTabContentKeyword()],
    setKeywords: vi.fn(),
    schedules: [],
    setSchedules: vi.fn(),
    execution: null,
    triggerAnalysis: vi.fn().mockResolvedValue({
      success: true,
      message: 'started',
    }),
    setActiveTab: vi.fn(),
    onNavigateToRawResponses: vi.fn(),
    ...overrides,
  };
}
