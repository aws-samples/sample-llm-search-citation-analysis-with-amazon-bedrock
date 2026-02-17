import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  fetchStats, fetchCitations, fetchSearches, fetchKeywords 
} from './dashboard';

vi.mock('./client', () => ({apiGet: vi.fn(),}));

import { apiGet } from './client';

const mockApiGet = apiGet as ReturnType<typeof vi.fn>;

describe('dashboard API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchStats', () => {
    it('returns stats from API', async () => {
      const mockStats = {
        total_keywords: 10,
        total_citations: 100 
      };
      mockApiGet.mockResolvedValue(mockStats);

      const result = await fetchStats();

      expect(result).toStrictEqual(mockStats);
      expect(mockApiGet).toHaveBeenCalledWith('/stats', { signal: undefined });
    });

    it('passes abort signal to apiGet', async () => {
      const controller = new AbortController();
      mockApiGet.mockResolvedValue({});

      await fetchStats(controller.signal);

      expect(mockApiGet).toHaveBeenCalledWith('/stats', { signal: controller.signal });
    });
  });

  describe('fetchCitations', () => {
    it('returns citations from API', async () => {
      const mockCitations = {
        provider_stats: [],
        top_urls: [] 
      };
      mockApiGet.mockResolvedValue(mockCitations);

      const result = await fetchCitations();

      expect(result).toStrictEqual(mockCitations);
      expect(mockApiGet).toHaveBeenCalledWith('/citations', { signal: undefined });
    });
  });

  describe('fetchSearches', () => {
    it('returns searches array from response', async () => {
      const mockSearches = [{
        keyword: 'test',
        provider: 'openai' 
      }];
      mockApiGet.mockResolvedValue({ searches: mockSearches });

      const result = await fetchSearches();

      expect(result).toStrictEqual(mockSearches);
    });

    it('returns empty array when searches is undefined', async () => {
      mockApiGet.mockResolvedValue({});

      const result = await fetchSearches();

      expect(result).toStrictEqual([]);
    });
  });

  describe('fetchKeywords', () => {
    it('returns keywords array from response', async () => {
      const mockKeywords = [{
        keyword: 'test',
        enabled: true 
      }];
      mockApiGet.mockResolvedValue({ keywords: mockKeywords });

      const result = await fetchKeywords();

      expect(result).toStrictEqual(mockKeywords);
    });

    it('returns empty array when keywords is undefined', async () => {
      mockApiGet.mockResolvedValue({});

      const result = await fetchKeywords();

      expect(result).toStrictEqual([]);
    });
  });
});
