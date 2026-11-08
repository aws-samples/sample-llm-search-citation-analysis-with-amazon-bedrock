import {
  describe, it, expect, vi 
} from 'vitest';
import { fetchCrawlHistory } from './dashboard';
import { mockApiGet } from './clientMock-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

const CRAWL = {
  normalized_url: 'example.com',
  title: 'Example',
  summary: '',
  content: '',
  crawled_at: '2026-09-18T00:00:00Z',
  keyword: 'hotels madrid',
  citation_count: 2,
  citing_providers: ['openai'],
};

describe('fetchCrawlHistory', () => {
  it('requests the 20 latest crawls of the encoded URL without their page text', async () => {
    mockApiGet.mockResolvedValue({ items: [] });

    await fetchCrawlHistory('https://example.com/a b');

    expect(mockApiGet).toHaveBeenCalledWith(
      '/crawled-content?url=https%3A%2F%2Fexample.com%2Fa+b&include_history=true&limit=20&include_content=false'
    );
  });

  it('continues after the previous page with its token', async () => {
    mockApiGet.mockResolvedValue({ items: [] });

    await fetchCrawlHistory('https://example.com', 'tok-2');

    expect(mockApiGet).toHaveBeenCalledWith(
      '/crawled-content?url=https%3A%2F%2Fexample.com&include_history=true&limit=20&include_content=false&next_token=tok-2'
    );
  });

  it('returns the page items and the next token', async () => {
    mockApiGet.mockResolvedValue({
      items: [CRAWL],
      next_token: 'tok-2',
    });

    await expect(fetchCrawlHistory('https://example.com')).resolves.toStrictEqual({
      items: [CRAWL],
      nextToken: 'tok-2',
    });
  });

  it('reads a response without items or token as an empty last page', async () => {
    mockApiGet.mockResolvedValue({});

    await expect(fetchCrawlHistory('https://example.com')).resolves.toStrictEqual({
      items: [],
      nextToken: null,
    });
  });
});
