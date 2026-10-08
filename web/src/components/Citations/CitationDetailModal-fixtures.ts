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

/** A YouTube video read through oEmbed: channel, thumbnail and no SEO analysis. */
export function buildVideoCrawl(overrides: Partial<CrawledContent> = {}): CrawledContent {
  return buildCrawledContent({
    normalized_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Hotel Sol room tour',
    summary: 'YouTube video "Hotel Sol room tour" by Hotel Sol.',
    content_type: 'video',
    provider: 'youtube',
    author_name: 'Hotel Sol',
    author_url: 'https://www.youtube.com/@hotelsol',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    ...overrides,
  });
}
