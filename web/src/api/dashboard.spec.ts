import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import { fetchCrawlHistory } from './dashboard';

vi.mock('./client', () => ({apiGet: vi.fn(),}));

import { apiGet } from './client';

const mockApiGet = apiGet as ReturnType<typeof vi.fn>;

describe('dashboard API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchCrawlHistory', () => {
    it('requests the crawled-content history for the encoded URL with the default limit', async () => {
      mockApiGet.mockResolvedValue({
        items: [],
        count: 0 
      });

      await fetchCrawlHistory('https://example.com/a b');

      expect(mockApiGet).toHaveBeenCalledWith(
        '/crawled-content?url=https%3A%2F%2Fexample.com%2Fa+b&include_history=true&limit=20',
        { signal: undefined }
      );
    });

    it('passes a custom limit and abort signal through', async () => {
      const controller = new AbortController();
      mockApiGet.mockResolvedValue({
        items: [],
        count: 0 
      });

      await fetchCrawlHistory('https://example.com', 5, controller.signal);

      expect(mockApiGet).toHaveBeenCalledWith(
        '/crawled-content?url=https%3A%2F%2Fexample.com&include_history=true&limit=5',
        { signal: controller.signal }
      );
    });

    it('returns the items array from the response', async () => {
      const items = [{
        normalized_url: 'example.com',
        title: 'Example',
        summary: '',
        content: '',
        crawled_at: '2026-09-18T00:00:00Z',
        keyword: 'hotels madrid',
        citation_count: 2,
        citing_providers: ['openai'],
      }];
      mockApiGet.mockResolvedValue({
        items,
        count: 1 
      });

      const result = await fetchCrawlHistory('https://example.com');

      expect(result).toStrictEqual(items);
    });

    it('returns an empty array when the response has no items', async () => {
      mockApiGet.mockResolvedValue({});

      const result = await fetchCrawlHistory('https://example.com');

      expect(result).toStrictEqual([]);
    });
  });
});
