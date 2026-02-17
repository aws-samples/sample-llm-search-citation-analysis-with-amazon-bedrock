import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  fetchContentHistory,
  fetchContentIdeas,
  generateContent,
  markContentViewed,
  deleteContent,
} from './content';

vi.mock('./client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

import {
  apiGet, apiPost, apiDelete 
} from './client';

const mockApiGet = apiGet as ReturnType<typeof vi.fn>;
const mockApiPost = apiPost as ReturnType<typeof vi.fn>;
const mockApiDelete = apiDelete as ReturnType<typeof vi.fn>;

describe('content API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchContentHistory', () => {
    it('returns items array from response', async () => {
      const mockItems = [{
        id: '1',
        keyword: 'test' 
      }];
      mockApiGet.mockResolvedValue({ items: mockItems });

      const result = await fetchContentHistory();

      expect(result).toStrictEqual(mockItems);
      expect(mockApiGet).toHaveBeenCalledWith('/content-studio/history', {
        params: { limit: '50' },
        signal: undefined,
      });
    });

    it('returns empty array when items is undefined', async () => {
      mockApiGet.mockResolvedValue({});

      const result = await fetchContentHistory();

      expect(result).toStrictEqual([]);
    });

    it('uses custom limit', async () => {
      mockApiGet.mockResolvedValue({ items: [] });

      await fetchContentHistory(100);

      expect(mockApiGet).toHaveBeenCalledWith('/content-studio/history', {
        params: { limit: '100' },
        signal: undefined,
      });
    });
  });

  describe('fetchContentIdeas', () => {
    it('returns ideas array from response', async () => {
      const mockIdeas = [{
        keyword: 'test',
        priority: 'high' 
      }];
      mockApiGet.mockResolvedValue({ ideas: mockIdeas });

      const result = await fetchContentIdeas();

      expect(result).toStrictEqual(mockIdeas);
      expect(mockApiGet).toHaveBeenCalledWith('/content-studio/ideas', { signal: undefined });
    });

    it('returns empty array when ideas is undefined', async () => {
      mockApiGet.mockResolvedValue({});

      const result = await fetchContentIdeas();

      expect(result).toStrictEqual([]);
    });
  });

  describe('generateContent', () => {
    it('posts content generation request', async () => {
      const mockResult = {
        id: '1',
        status: 'generating' 
      };
      mockApiPost.mockResolvedValue(mockResult);

      const result = await generateContent({
        keyword: 'hotels',
        ideaType: 'blog',
        ideaTitle: 'Best Hotels',
        contentAngle: 'luxury',
      });

      expect(result).toStrictEqual(mockResult);
      expect(mockApiPost).toHaveBeenCalledWith(
        '/content-studio/generate',
        {
          keyword: 'hotels',
          idea_type: 'blog',
          idea_title: 'Best Hotels',
          content_angle: 'luxury',
          competitor_urls: [],
        },
        { signal: undefined }
      );
    });

    it('includes competitor URLs when provided', async () => {
      mockApiPost.mockResolvedValue({});

      await generateContent({
        keyword: 'hotels',
        ideaType: 'blog',
        ideaTitle: 'Best Hotels',
        contentAngle: 'luxury',
        competitorUrls: ['https://example.com'],
      });

      expect(mockApiPost).toHaveBeenCalledWith(
        '/content-studio/generate',
        expect.objectContaining({competitor_urls: ['https://example.com'],}),
        { signal: undefined }
      );
    });
  });

  describe('markContentViewed', () => {
    it('marks content as viewed', async () => {
      mockApiPost.mockResolvedValue({ success: true });

      const result = await markContentViewed('content-1');

      expect(result.success).toBe(true);
      expect(mockApiPost).toHaveBeenCalledWith('/content-studio/viewed', { id: 'content-1' });
    });
  });

  describe('deleteContent', () => {
    it('deletes content and returns message', async () => {
      mockApiDelete.mockResolvedValue({ message: 'Deleted' });

      const result = await deleteContent('content-1');

      expect(result.message).toBe('Deleted');
      expect(mockApiDelete).toHaveBeenCalledWith('/content-studio/content-1');
    });
  });
});
