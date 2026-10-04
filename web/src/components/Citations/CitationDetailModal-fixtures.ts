import type { CrawledContent } from '../../types';

/** A crawled citation page with load metrics; every field can be overridden. */
export function buildCrawledContent(overrides: Partial<CrawledContent> = {}): CrawledContent {
  return {
    normalized_url: 'example.com/rooms',
    title: 'Rooms at Hotel Sol',
    summary: 'The rooms of Hotel Sol.',
    content: 'Hotel Sol has sea-view rooms.',
    crawled_at: '2026-03-01T10:00:00Z',
    keyword: 'hotels in madrid',
    citation_count: 4,
    citing_providers: ['openai', 'gemini'],
    page_load_time_ms: 820,
    content_length: 12_345,
    ...overrides,
  };
}
