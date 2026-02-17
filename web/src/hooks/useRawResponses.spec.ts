import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useRawResponses } from './useRawResponses';
import {
  mockBrowseResponse, mockFileContent, createMockFetch 
} from './useRawResponses-fixtures';

vi.mock('../infrastructure', async () => {
  const actual = await vi.importActual('../infrastructure');
  return {
    ...actual,
    API_BASE_URL: 'https://api.test.com',
    authenticatedFetch: vi.fn(),
  };
});

import { authenticatedFetch } from '../infrastructure';

const mockAuthenticatedFetch = vi.mocked(authenticatedFetch);

describe('useRawResponses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns loading false initially', () => {
      const { result } = renderHook(() => useRawResponses());
      expect(result.current.loading).toBe(false);
    });

    it('returns null browseData initially', () => {
      const { result } = renderHook(() => useRawResponses());
      expect(result.current.browseData).toBeNull();
    });

    it('returns null fileContent initially', () => {
      const { result } = renderHook(() => useRawResponses());
      expect(result.current.fileContent).toBeNull();
    });

    it('returns null error initially', () => {
      const { result } = renderHook(() => useRawResponses());
      expect(result.current.error).toBeNull();
    });
  });

  describe('browse', () => {
    it('browses and returns folder contents', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRawResponses());

      const browseResult = await act(async () => {
        return await result.current.browse();
      });

      expect(browseResult).not.toBeNull();
      expect(browseResult?.folders).toHaveLength(2);
      expect(browseResult?.files).toHaveLength(2);
      expect(result.current.browseData).toStrictEqual(mockBrowseResponse);
    });

    it('includes prefix in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRawResponses());

      await act(async () => {
        await result.current.browse('2024-01-01/');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('prefix=2024-01-01%2F');
    });

    it('includes bucket type in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRawResponses());

      await act(async () => {
        await result.current.browse('', 'screenshots');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('bucket=screenshots');
    });

    it('uses default bucket of responses', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRawResponses());

      await act(async () => {
        await result.current.browse();
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('bucket=responses');
    });

    it('sets loading true while browsing', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve(mockBrowseResponse) 
      } as unknown as Response;
      
      const pendingPromise = Promise.resolve(mockResponse);
      mockAuthenticatedFetch.mockImplementation(() => pendingPromise);

      const { result } = renderHook(() => useRawResponses());

      act(() => { result.current.browse(); });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        await pendingPromise;
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('sets error when browse fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

      const { result } = renderHook(() => useRawResponses());

      await act(async () => {
        await result.current.browse();
      });

      expect(result.current.error).toBeTruthy();
    });

    it('returns null when browse fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

      const { result } = renderHook(() => useRawResponses());

      const browseResult = await act(async () => {
        return await result.current.browse();
      });

      expect(browseResult).toBeNull();
    });
  });

  describe('getFile', () => {
    it('fetches and returns file content', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRawResponses());

      const fileResult = await act(async () => {
        return await result.current.getFile('responses/file1.json');
      });

      expect(fileResult).not.toBeNull();
      expect(fileResult?.key).toBe('responses/file1.json');
      expect(fileResult?.content).toBeTruthy();
      expect(result.current.fileContent).toStrictEqual(mockFileContent);
    });

    it('includes key in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRawResponses());

      await act(async () => {
        await result.current.getFile('path/to/file.json');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('key=path%2Fto%2Ffile.json');
    });

    it('includes bucket type in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRawResponses());

      await act(async () => {
        await result.current.getFile('file.png', 'screenshots');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('bucket=screenshots');
    });

    it('sets error when getFile fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFailFile: true }));

      const { result } = renderHook(() => useRawResponses());

      await act(async () => {
        await result.current.getFile('nonexistent.json');
      });

      expect(result.current.error).toBeTruthy();
    });

    it('returns null when getFile fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFailFile: true }));

      const { result } = renderHook(() => useRawResponses());

      const fileResult = await act(async () => {
        return await result.current.getFile('nonexistent.json');
      });

      expect(fileResult).toBeNull();
    });
  });

  describe('getDownloadUrl', () => {
    it('returns presigned download URL', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRawResponses());

      const downloadUrl = await act(async () => {
        return await result.current.getDownloadUrl('file.json');
      });

      expect(downloadUrl).toBe('https://s3.example.com/presigned-url');
    });

    it('includes key in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRawResponses());

      await act(async () => {
        await result.current.getDownloadUrl('path/to/file.json');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toContain('key=path%2Fto%2Ffile.json');
    });

    it('returns null when getDownloadUrl fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFailDownload: true }));

      const { result } = renderHook(() => useRawResponses());

      const downloadUrl = await act(async () => {
        return await result.current.getDownloadUrl('file.json');
      });

      expect(downloadUrl).toBeNull();
    });
  });

  describe('clearFile', () => {
    it('clears fileContent state', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useRawResponses());

      await act(async () => {
        await result.current.getFile('file.json');
      });

      expect(result.current.fileContent).not.toBeNull();

      act(() => {
        result.current.clearFile();
      });

      expect(result.current.fileContent).toBeNull();
    });
  });
});
