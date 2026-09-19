import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useRawResponses } from './useRawResponses';
import {
  mockBrowseResponse, mockFileContent, createMockFetch 
} from './useRawResponses-fixtures';
import {
  createDeferredResponse, createMockJsonResponse 
} from '../test/fetchResponses';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

type RawResponsesHook = ReturnType<typeof useRawResponses>;

describe('useRawResponses', () => {
  it('starts with no browse data, no file content, not loading, and no error', () => {
    const { result } = renderHook(() => useRawResponses());

    expect(result.current).toStrictEqual({
      loading: false,
      error: null,
      browseData: null,
      fileContent: null,
      browse: expect.any(Function),
      getFile: expect.any(Function),
      getDownloadUrl: expect.any(Function),
      clearFile: expect.any(Function),
    });
  });

  it.each<[url: string, condition: string, run: (hook: RawResponsesHook) => Promise<unknown>]>([
    ['https://api.test.com/raw-responses/browse?prefix=2024-01-01%2F&bucket=responses', 'browsing a folder prefix', (hook) => hook.browse('2024-01-01/')],
    ['https://api.test.com/raw-responses/browse?prefix=&bucket=screenshots', 'browsing the screenshots bucket', (hook) => hook.browse('', 'screenshots')],
    ['https://api.test.com/raw-responses/browse?prefix=&bucket=responses', 'browsing with no arguments', (hook) => hook.browse()],
    ['https://api.test.com/raw-responses/file?key=path%2Fto%2Ffile.json&bucket=responses', 'fetching a file by key', (hook) => hook.getFile('path/to/file.json')],
    ['https://api.test.com/raw-responses/file?key=file.png&bucket=screenshots', 'fetching a file from the screenshots bucket', (hook) => hook.getFile('file.png', 'screenshots')],
    ['https://api.test.com/raw-responses/download?key=path%2Fto%2Ffile.json&bucket=responses', 'requesting a download URL by key', (hook) => hook.getDownloadUrl('path/to/file.json')],
  ])('requests %s when %s', async (url, _condition, run) => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const { result } = renderHook(() => useRawResponses());

    await act(() => run(result.current));

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url);
  });

  describe('browse', () => {
    it('returns and stores the folder listing when the response has a prefix', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());
      const { result } = renderHook(() => useRawResponses());

      const returned = await act(() => result.current.browse());

      expect(returned).toStrictEqual(mockBrowseResponse);
      expect(result.current.browseData).toStrictEqual(mockBrowseResponse);
    });

    it('sets loading true while the browse request is in flight', async () => {
      const deferred = createDeferredResponse();
      mockAuthenticatedFetch.mockReturnValue(deferred.promise);
      const { result } = renderHook(() => useRawResponses());

      act(() => {
        result.current.browse();
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.resolve(createMockJsonResponse(mockBrowseResponse));
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('resolves null and reports the server failure when browsing fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));
      const { result } = renderHook(() => useRawResponses());

      const returned = await act(() => result.current.browse());

      expect(returned).toBeNull();
      expect(result.current.error).toBe('Failed to load response data');
    });
  });

  describe('getFile', () => {
    it('returns and stores the file content when the response has a key', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());
      const { result } = renderHook(() => useRawResponses());

      const returned = await act(() => result.current.getFile('responses/file1.json'));

      expect(returned).toStrictEqual(mockFileContent);
      expect(result.current.fileContent).toStrictEqual(mockFileContent);
    });

    it('resolves null and reports the missing file when the file request fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFailFile: true }));
      const { result } = renderHook(() => useRawResponses());

      const returned = await act(() => result.current.getFile('nonexistent.json'));

      expect(returned).toBeNull();
      expect(result.current.error).toBe('Response file not found');
    });
  });

  describe('getDownloadUrl', () => {
    it('returns the presigned download URL when the request succeeds', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());
      const { result } = renderHook(() => useRawResponses());

      const downloadUrl = await act(() => result.current.getDownloadUrl('file.json'));

      expect(downloadUrl).toBe('https://s3.example.com/presigned-url');
    });

    it('resolves null when the download request fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFailDownload: true }));
      const { result } = renderHook(() => useRawResponses());

      const downloadUrl = await act(() => result.current.getDownloadUrl('file.json'));

      expect(downloadUrl).toBeNull();
    });
  });

  describe('clearFile', () => {
    it('resets fileContent to null after a file was loaded', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());
      const { result } = renderHook(() => useRawResponses());
      await act(() => result.current.getFile('file.json'));
      expect(result.current.fileContent).toStrictEqual(mockFileContent);

      act(() => {
        result.current.clearFile();
      });

      expect(result.current.fileContent).toBeNull();
    });
  });
});
