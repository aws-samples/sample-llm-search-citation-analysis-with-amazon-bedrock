import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  browseRawResponses, fetchRawResponseFile, downloadRawResponse 
} from './rawResponses';

vi.mock('./client', () => ({apiGet: vi.fn(),}));

import { apiGet } from './client';

const mockApiGet = apiGet as ReturnType<typeof vi.fn>;

describe('rawResponses API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('browseRawResponses', () => {
    it('browses with prefix param', async () => {
      const mockResponse = {
        files: [],
        folders: [] 
      };
      mockApiGet.mockResolvedValue(mockResponse);

      const result = await browseRawResponses('responses/2024/');

      expect(result).toStrictEqual(mockResponse);
      expect(mockApiGet).toHaveBeenCalledWith('/raw-responses/browse', {
        params: { prefix: 'responses/2024/' },
        signal: undefined,
      });
    });

    it('passes abort signal', async () => {
      const controller = new AbortController();
      mockApiGet.mockResolvedValue({});

      await browseRawResponses('prefix/', controller.signal);

      expect(mockApiGet).toHaveBeenCalledWith('/raw-responses/browse', {
        params: { prefix: 'prefix/' },
        signal: controller.signal,
      });
    });
  });

  describe('fetchRawResponseFile', () => {
    it('fetches file content by key', async () => {
      const mockContent = {
        content: 'file content',
        content_type: 'text/plain' 
      };
      mockApiGet.mockResolvedValue(mockContent);

      const result = await fetchRawResponseFile('responses/file.json');

      expect(result).toStrictEqual(mockContent);
      expect(mockApiGet).toHaveBeenCalledWith('/raw-responses/file', {
        params: { key: 'responses/file.json' },
        signal: undefined,
      });
    });
  });

  describe('downloadRawResponse', () => {
    it('returns download URL from response', async () => {
      mockApiGet.mockResolvedValue({ url: 'https://s3.example.com/file.json' });

      const result = await downloadRawResponse('responses/file.json');

      expect(result).toBe('https://s3.example.com/file.json');
      expect(mockApiGet).toHaveBeenCalledWith('/raw-responses/download', {
        params: { key: 'responses/file.json' },
        signal: undefined,
      });
    });
  });
});
