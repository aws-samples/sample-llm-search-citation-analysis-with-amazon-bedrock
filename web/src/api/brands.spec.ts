import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  fetchBrandMentions,
  fetchBrandConfig,
  fetchBrandPresets,
  saveBrandConfig,
  deleteBrandConfig,
  expandBrand,
  expandAllBrands,
  findCompetitors,
} from './brands';

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

describe('brands API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchBrandMentions', () => {
    it('fetches mentions with keyword param', async () => {
      const mockResponse = {
        mentions: [],
        summary: {} 
      };
      mockApiGet.mockResolvedValue(mockResponse);

      const result = await fetchBrandMentions({ keyword: 'hotels' });

      expect(result).toStrictEqual(mockResponse);
      expect(mockApiGet).toHaveBeenCalledWith('/brand-mentions', {
        params: { keyword: 'hotels' },
        signal: undefined,
      });
    });

    it('includes classification filter when provided', async () => {
      mockApiGet.mockResolvedValue({});

      await fetchBrandMentions({
        keyword: 'hotels',
        classificationFilter: 'first_party' 
      });

      expect(mockApiGet).toHaveBeenCalledWith('/brand-mentions', {
        params: {
          keyword: 'hotels',
          classification: 'first_party' 
        },
        signal: undefined,
      });
    });
  });

  describe('fetchBrandConfig', () => {
    it('returns brand config from API', async () => {
      const mockConfig = {
        first_party_brands: ['Brand1'],
        competitor_brands: [] 
      };
      mockApiGet.mockResolvedValue(mockConfig);

      const result = await fetchBrandConfig();

      expect(result).toStrictEqual(mockConfig);
      expect(mockApiGet).toHaveBeenCalledWith('/brand-config', { signal: undefined });
    });
  });

  describe('fetchBrandPresets', () => {
    it('returns presets from response', async () => {
      const mockPresets = {
        hotel: {
          first_party: [],
          competitors: [] 
        } 
      };
      mockApiGet.mockResolvedValue({ presets: mockPresets });

      const result = await fetchBrandPresets();

      expect(result).toStrictEqual(mockPresets);
    });
  });

  describe('saveBrandConfig', () => {
    it('posts config and returns result', async () => {
      const config = {
        first_party_brands: ['Brand1'],
        competitor_brands: [] 
      };
      mockApiPost.mockResolvedValue(config);

      const result = await saveBrandConfig(config as never);

      expect(result).toStrictEqual(config);
      expect(mockApiPost).toHaveBeenCalledWith('/brand-config', config);
    });
  });

  describe('deleteBrandConfig', () => {
    it('deletes config and returns message', async () => {
      mockApiDelete.mockResolvedValue({ message: 'Deleted' });

      const result = await deleteBrandConfig();

      expect(result.message).toBe('Deleted');
      expect(mockApiDelete).toHaveBeenCalledWith('/brand-config');
    });
  });

  describe('expandBrand', () => {
    it('posts brand name and returns expansion result', async () => {
      const mockResult = {
        suggestions: ['Brand2'],
        parent_company: 'Parent' 
      };
      mockApiPost.mockResolvedValue(mockResult);

      const result = await expandBrand('Brand1', ['Existing']);

      expect(result).toStrictEqual(mockResult);
      expect(mockApiPost).toHaveBeenCalledWith('/brand-config/expand', {
        brand_name: 'Brand1',
        existing_brands: ['Existing'],
      });
    });

    it('uses empty array for existing brands by default', async () => {
      mockApiPost.mockResolvedValue({});

      await expandBrand('Brand1');

      expect(mockApiPost).toHaveBeenCalledWith('/brand-config/expand', {
        brand_name: 'Brand1',
        existing_brands: [],
      });
    });
  });

  describe('expandAllBrands', () => {
    it('posts brands with type and returns result', async () => {
      const mockResult = {
        suggestions: [],
        existing_brands: [] 
      };
      mockApiPost.mockResolvedValue(mockResult);

      const result = await expandAllBrands(['Brand1'], 'competitor');

      expect(result).toStrictEqual(mockResult);
      expect(mockApiPost).toHaveBeenCalledWith('/brand-config/expand-all', {
        existing_brands: ['Brand1'],
        brand_type: 'competitor',
      });
    });

    it('defaults to first_party brand type', async () => {
      mockApiPost.mockResolvedValue({});

      await expandAllBrands(['Brand1']);

      expect(mockApiPost).toHaveBeenCalledWith('/brand-config/expand-all', {
        existing_brands: ['Brand1'],
        brand_type: 'first_party',
      });
    });
  });

  describe('findCompetitors', () => {
    it('posts first party brands and returns competitors', async () => {
      const mockResult = {competitors: ['Competitor1']};
      mockApiPost.mockResolvedValue(mockResult);

      const result = await findCompetitors(['Brand1'], ['Existing']);

      expect(result).toStrictEqual(mockResult);
      expect(mockApiPost).toHaveBeenCalledWith('/brand-config/find-competitors', {
        first_party_brands: ['Brand1'],
        existing_competitors: ['Existing'],
      });
    });

    it('uses empty array for existing competitors by default', async () => {
      mockApiPost.mockResolvedValue({});

      await findCompetitors(['Brand1']);

      expect(mockApiPost).toHaveBeenCalledWith('/brand-config/find-competitors', {
        first_party_brands: ['Brand1'],
        existing_competitors: [],
      });
    });
  });
});
