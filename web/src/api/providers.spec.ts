import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  fetchProviders, updateProvider, validateProvider 
} from './providers';

vi.mock('./client', () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  apiPost: vi.fn(),
}));

import {
  apiGet, apiPut, apiPost 
} from './client';

const mockApiGet = apiGet as ReturnType<typeof vi.fn>;
const mockApiPut = apiPut as ReturnType<typeof vi.fn>;
const mockApiPost = apiPost as ReturnType<typeof vi.fn>;

describe('providers API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchProviders', () => {
    it('returns providers array from response', async () => {
      const mockProviders = [
        {
          provider_id: 'openai',
          display_name: 'OpenAI',
          enabled: true 
        },
      ];
      mockApiGet.mockResolvedValue({ providers: mockProviders });

      const result = await fetchProviders();

      expect(result).toStrictEqual(mockProviders);
      expect(mockApiGet).toHaveBeenCalledWith('/providers', { signal: undefined });
    });

    it('returns empty array when providers is undefined', async () => {
      mockApiGet.mockResolvedValue({});

      const result = await fetchProviders();

      expect(result).toStrictEqual([]);
    });

    it('passes abort signal to apiGet', async () => {
      const controller = new AbortController();
      mockApiGet.mockResolvedValue({ providers: [] });

      await fetchProviders(controller.signal);

      expect(mockApiGet).toHaveBeenCalledWith('/providers', { signal: controller.signal });
    });
  });

  describe('updateProvider', () => {
    it('updates provider with enabled status', async () => {
      const mockResult = {
        provider_id: 'openai',
        enabled: false 
      };
      mockApiPut.mockResolvedValue(mockResult);

      const result = await updateProvider('openai', { enabled: false });

      expect(result).toStrictEqual(mockResult);
      expect(mockApiPut).toHaveBeenCalledWith('/providers/openai', { enabled: false });
    });

    it('updates provider with model', async () => {
      mockApiPut.mockResolvedValue({});

      await updateProvider('openai', {
        enabled: true,
        model: 'gpt-4' 
      });

      expect(mockApiPut).toHaveBeenCalledWith('/providers/openai', {
        enabled: true,
        model: 'gpt-4',
      });
    });
  });

  describe('validateProvider', () => {
    it('validates provider and returns result', async () => {
      const mockResult = {
        valid: true,
        model: 'gpt-4' 
      };
      mockApiPost.mockResolvedValue(mockResult);

      const result = await validateProvider('openai');

      expect(result).toStrictEqual(mockResult);
      expect(mockApiPost).toHaveBeenCalledWith('/providers/openai/validate', {});
    });

    it('returns invalid result with message', async () => {
      const mockResult = {
        valid: false,
        message: 'Invalid API key' 
      };
      mockApiPost.mockResolvedValue(mockResult);

      const result = await validateProvider('openai');

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Invalid API key');
    });
  });
});
