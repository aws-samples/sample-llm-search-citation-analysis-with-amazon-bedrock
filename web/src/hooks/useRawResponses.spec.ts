import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, act
} from '@testing-library/react';
import { useRawResponses } from './useRawResponses';
import {
  mockBrowseResponse, mockFileContent, createMockFetch, renderRawResponsesAfter
} from './useRawResponses-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import { waitForLoaded } from '../test/loadedHook';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import {
  deferAuthenticatedFetch, mockAuthenticatedFetch 
} from '../test/infrastructureMock';

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
    await renderRawResponsesAfter(run);

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url);
  });

  describe('browse', () => {
    it('returns and stores the folder listing when the response has a prefix', async () => {
      const {
        returned, result
      } = await renderRawResponsesAfter((hook) => hook.browse());

      expect(returned).toStrictEqual(mockBrowseResponse);
      expect(result.current.browseData).toStrictEqual(mockBrowseResponse);
    });

    it('sets loading true while the browse request is in flight', async () => {
      const deferred = deferAuthenticatedFetch();
      const { result } = renderHook(() => useRawResponses());

      act(() => {
        result.current.browse();
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.resolve(createMockJsonResponse(mockBrowseResponse));
      });
      await waitForLoaded(result);
    });

    it('resolves null and reports the server failure when browsing fails', async () => {
      const {
        returned, result
      } = await renderRawResponsesAfter((hook) => hook.browse(), createMockFetch({ shouldFail: true }));

      expect(returned).toBeNull();
      expect(result.current.error).toBe('Failed to load response data');
    });
  });

  it('keeps the stored folder listing when a later browse response has no prefix', async () => {
    const { result } = await renderRawResponsesAfter((hook) => hook.browse());
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({ folders: [] }));

    const returned = await act(() => result.current.browse('2024-01-01/'));

    expect(returned).toBeNull();
    expect(result.current.browseData).toStrictEqual(mockBrowseResponse);
  });

  it.each<[action: string, run: (hook: RawResponsesHook) => Promise<unknown>]>([
    ['browsing', (hook) => hook.browse()],
    ['getting file', (hook) => hook.getFile('file.json')],
    ['getting download URL', (hook) => hook.getDownloadUrl('file.json')],
  ])('logs "[rawResponses] Error %s:" with the HTTP status when the request fails', async (action, run) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());

    await renderRawResponsesAfter(run, createMockFetch({ shouldFail: true }));

    expect(consoleError).toHaveBeenCalledWith(`[rawResponses] Error ${action}:`, expect.objectContaining({
      name: 'RawResponsesError',
      message: 'HTTP 500',
    }));
  });

  describe('getFile', () => {
    it('returns and stores the file content when the response has a key', async () => {
      const {
        returned, result
      } = await renderRawResponsesAfter((hook) => hook.getFile('responses/file1.json'));

      expect(returned).toStrictEqual(mockFileContent);
      expect(result.current.fileContent).toStrictEqual(mockFileContent);
    });

    it('resolves null and reports the missing file when the file request fails', async () => {
      const {
        returned, result
      } = await renderRawResponsesAfter((hook) => hook.getFile('nonexistent.json'), createMockFetch({ shouldFailFile: true }));

      expect(returned).toBeNull();
      expect(result.current.error).toBe('Response file not found');
    });
  });

  describe('getDownloadUrl', () => {
    it.each([
      {
        name: 'returns the presigned download URL when the request succeeds',
        fetch: createMockFetch(),
        expected: 'https://s3.example.com/presigned-url',
      },
      {
        name: 'resolves null when the download request fails',
        fetch: createMockFetch({ shouldFailDownload: true }),
        expected: null,
      },
    ])('$name', async ({
      fetch, expected 
    }) => {
      const { returned: downloadUrl } = await renderRawResponsesAfter((hook) => hook.getDownloadUrl('file.json'), fetch);

      expect(downloadUrl).toBe(expected);
    });
  });

  describe('clearFile', () => {
    it('resets fileContent to null after a file was loaded', async () => {
      const { result } = await renderRawResponsesAfter((hook) => hook.getFile('file.json'));
      expect(result.current.fileContent).toStrictEqual(mockFileContent);

      act(() => {
        result.current.clearFile();
      });

      expect(result.current.fileContent).toBeNull();
    });
  });
});
