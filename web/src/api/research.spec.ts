import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  expandKeywords,
  analyzeCompetitor,
  fetchResearchHistory,
  deleteResearchItem,
} from './research';

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

describe('research API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('expandKeywords', () => {
    it('expands seed keyword with default count', async () => {
      const mockResult = {keywords: ['hotel deals', 'luxury hotels']};
      mockApiPost.mockResolvedValue(mockResult);

      const result = await expandKeywords({
        seedKeyword: 'hotels',
        industry: 'travel',
      });

      expect(result).toStrictEqual(mockResult);
      expect(mockApiPost).toHaveBeenCalledWith(
        '/keyword-research/expand',
        {
          seed_keyword: 'hotels',
          industry: 'travel',
          count: 20,
        },
        { signal: undefined }
      );
    });

    it('uses custom count when provided', async () => {
      mockApiPost.mockResolvedValue({});

      await expandKeywords({
        seedKeyword: 'hotels',
        industry: 'travel',
        count: 50,
      });

      expect(mockApiPost).toHaveBeenCalledWith(
        '/keyword-research/expand',
        expect.objectContaining({ count: 50 }),
        { signal: undefined }
      );
    });
  });

  describe('analyzeCompetitor', () => {
    it('analyzes competitor URL', async () => {
      const mockResult = {
        keywords: ['hotel', 'resort'],
        domain: 'example.com' 
      };
      mockApiPost.mockResolvedValue(mockResult);

      const result = await analyzeCompetitor({
        url: 'https://example.com',
        industry: 'travel',
      });

      expect(result).toStrictEqual(mockResult);
      expect(mockApiPost).toHaveBeenCalledWith(
        '/keyword-research/competitor',
        {
          url: 'https://example.com',
          industry: 'travel',
        },
        { signal: undefined }
      );
    });
  });

  describe('fetchResearchHistory', () => {
    it('returns items array from response', async () => {
      const mockItems = [{
        id: '1',
        type: 'expansion' 
      }];
      mockApiGet.mockResolvedValue({ items: mockItems });

      const result = await fetchResearchHistory();

      expect(result).toStrictEqual(mockItems);
      expect(mockApiGet).toHaveBeenCalledWith('/keyword-research/history', {
        params: { limit: '50' },
        signal: undefined,
      });
    });

    it('returns empty array when items is undefined', async () => {
      mockApiGet.mockResolvedValue({});

      const result = await fetchResearchHistory();

      expect(result).toStrictEqual([]);
    });

    it('filters by type when provided', async () => {
      mockApiGet.mockResolvedValue({ items: [] });

      await fetchResearchHistory({ type: 'competitor' });

      expect(mockApiGet).toHaveBeenCalledWith('/keyword-research/history', {
        params: {
          limit: '50',
          type: 'competitor' 
        },
        signal: undefined,
      });
    });

    it('uses custom limit', async () => {
      mockApiGet.mockResolvedValue({ items: [] });

      await fetchResearchHistory({ limit: 100 });

      expect(mockApiGet).toHaveBeenCalledWith('/keyword-research/history', {
        params: { limit: '100' },
        signal: undefined,
      });
    });
  });

  describe('deleteResearchItem', () => {
    it('deletes item and returns message', async () => {
      mockApiDelete.mockResolvedValue({ message: 'Deleted' });

      const result = await deleteResearchItem('item-1');

      expect(result.message).toBe('Deleted');
      expect(mockApiDelete).toHaveBeenCalledWith('/keyword-research/item-1');
    });
  });
});
