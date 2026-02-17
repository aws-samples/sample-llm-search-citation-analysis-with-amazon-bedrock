import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  fetchVisibilityMetrics,
  fetchPromptInsights,
  fetchCitationGaps,
  fetchRecommendations,
  fetchHistoricalTrends,
} from './visibility';

vi.mock('./client', () => ({apiGet: vi.fn(),}));

import { apiGet } from './client';

const mockApiGet = apiGet as ReturnType<typeof vi.fn>;

describe('visibility API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchVisibilityMetrics', () => {
    it('fetches metrics with keyword param', async () => {
      const mockResponse = {
        visibility_score: 75,
        brand_mentions: [] 
      };
      mockApiGet.mockResolvedValue(mockResponse);

      const result = await fetchVisibilityMetrics({ keyword: 'hotels' });

      expect(result).toStrictEqual(mockResponse);
      expect(mockApiGet).toHaveBeenCalledWith('/visibility', {
        params: { keyword: 'hotels' },
        signal: undefined,
      });
    });

    it('includes brand param when provided', async () => {
      mockApiGet.mockResolvedValue({});

      await fetchVisibilityMetrics({
        keyword: 'hotels',
        brand: 'Marriott' 
      });

      expect(mockApiGet).toHaveBeenCalledWith('/visibility', {
        params: {
          keyword: 'hotels',
          brand: 'Marriott' 
        },
        signal: undefined,
      });
    });
  });

  describe('fetchPromptInsights', () => {
    it('fetches insights with default limit', async () => {
      const mockResponse = {
        prompts: [],
        total: 0 
      };
      mockApiGet.mockResolvedValue(mockResponse);

      const result = await fetchPromptInsights();

      expect(result).toStrictEqual(mockResponse);
      expect(mockApiGet).toHaveBeenCalledWith('/prompt-insights', {
        params: { limit: '50' },
        signal: undefined,
      });
    });

    it('uses custom limit when provided', async () => {
      mockApiGet.mockResolvedValue({});

      await fetchPromptInsights({ limit: 100 });

      expect(mockApiGet).toHaveBeenCalledWith('/prompt-insights', {
        params: { limit: '100' },
        signal: undefined,
      });
    });
  });

  describe('fetchCitationGaps', () => {
    it('fetches gaps for all keywords by default', async () => {
      const mockResponse = {
        gaps: [],
        summary: {} 
      };
      mockApiGet.mockResolvedValue(mockResponse);

      const result = await fetchCitationGaps();

      expect(result).toStrictEqual(mockResponse);
      expect(mockApiGet).toHaveBeenCalledWith('/citation-gaps', {
        params: {},
        signal: undefined,
      });
    });

    it('fetches gaps for specific keyword', async () => {
      mockApiGet.mockResolvedValue({});

      await fetchCitationGaps({ keyword: 'hotels' });

      expect(mockApiGet).toHaveBeenCalledWith('/citation-gaps', {
        params: { keyword: 'hotels' },
        signal: undefined,
      });
    });
  });

  describe('fetchRecommendations', () => {
    it('fetches recommendations without LLM by default', async () => {
      const mockResponse = {recommendations: []};
      mockApiGet.mockResolvedValue(mockResponse);

      const result = await fetchRecommendations();

      expect(result).toStrictEqual(mockResponse);
      expect(mockApiGet).toHaveBeenCalledWith('/recommendations', {
        params: { use_llm: 'false' },
        signal: undefined,
      });
    });

    it('fetches recommendations with LLM when enabled', async () => {
      mockApiGet.mockResolvedValue({});

      await fetchRecommendations({ useLlm: true });

      expect(mockApiGet).toHaveBeenCalledWith('/recommendations', {
        params: { use_llm: 'true' },
        signal: undefined,
      });
    });
  });

  describe('fetchHistoricalTrends', () => {
    it('fetches trends with default days', async () => {
      const mockResponse = {
        trends: [],
        period: '30d' 
      };
      mockApiGet.mockResolvedValue(mockResponse);

      const result = await fetchHistoricalTrends();

      expect(result).toStrictEqual(mockResponse);
      expect(mockApiGet).toHaveBeenCalledWith('/trends', {
        params: { days: '30' },
        signal: undefined,
      });
    });

    it('fetches trends for specific keyword and days', async () => {
      mockApiGet.mockResolvedValue({});

      await fetchHistoricalTrends({
        keyword: 'hotels',
        days: 7 
      });

      expect(mockApiGet).toHaveBeenCalledWith('/trends', {
        params: {
          keyword: 'hotels',
          days: '7' 
        },
        signal: undefined,
      });
    });
  });
});
