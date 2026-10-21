import { vi } from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import type {
  S3BrowseResponse, RawResponseContent 
} from '../types';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { createMockJsonResponse } from '../test/fetchResponses';
import { useRawResponses } from './useRawResponses';

/**
 * Points the mocked network layer at `fetch` (the default browse/file/download
 * mock unless a spec hands in another) and renders the hook.
 */
function renderRawResponses(fetch: ReturnType<typeof createMockFetch> = createMockFetch()) {
  mockAuthenticatedFetch.mockImplementation(fetch);
  return renderHook(() => useRawResponses());
}

/**
 * `renderRawResponses(fetch)`, then runs `operation` on the hook once inside
 * `act`; `returned` is what the operation resolved with.
 */
export async function renderRawResponsesAfter<TResult>(
  operation: (hook: ReturnType<typeof useRawResponses>) => Promise<TResult>,
  fetch: ReturnType<typeof createMockFetch> = createMockFetch()
) {
  const rendered = renderRawResponses(fetch);
  const returned = await act(() => operation(rendered.result.current));
  return {
    returned,
    ...rendered,
  };
}

export const mockBrowseResponse: S3BrowseResponse = {
  prefix: 'responses/',
  folders: [
    {
      name: '2024-01-01',
      path: 'responses/2024-01-01/',
      type: 'folder' 
    },
    {
      name: '2024-01-02',
      path: 'responses/2024-01-02/',
      type: 'folder' 
    }
  ],
  files: [
    {
      name: 'file1.json',
      path: 'responses/file1.json',
      type: 'file',
      size: 1024,
      last_modified: '2024-01-01T00:00:00Z' 
    },
    {
      name: 'file2.json',
      path: 'responses/file2.json',
      type: 'file',
      size: 2048,
      last_modified: '2024-01-02T00:00:00Z' 
    },
  ],
  total_folders: 2,
  total_files: 2,
};

/** The first page of a folder too large for one S3 listing. */
export const firstBrowsePage: S3BrowseResponse = {
  prefix: 'raw-responses/2024-01-01/',
  folders: [],
  files: [{
    name: 'b.json',
    path: 'raw-responses/2024-01-01/b.json',
    type: 'file' 
  }],
  total_folders: 0,
  total_files: 1,
  next_token: 'page-2',
};

export const lastBrowsePage: S3BrowseResponse = {
  ...firstBrowsePage,
  files: [{
    name: 'c.json',
    path: 'raw-responses/2024-01-01/c.json',
    type: 'file' 
  }],
  next_token: null,
};

export const mockFileContent: RawResponseContent = {
  key: 'responses/file1.json',
  content: '{"keyword": "test", "response": "data"}',
  content_type: 'application/json',
  size: 1024,
  last_modified: '2024-01-01T00:00:00Z',
  is_json: true,
};

interface MockFetchOptions {
  browseResponse?: S3BrowseResponse;
  /** Answered to a browse request that carries a `next_token`. */
  nextBrowseResponse?: S3BrowseResponse;
  fileResponse?: RawResponseContent;
  downloadUrl?: string;
  shouldFail?: boolean;
  shouldFailFile?: boolean;
  shouldFailDownload?: boolean;
}

function browseAnswer(url: string, options: MockFetchOptions): S3BrowseResponse {
  return url.includes('next_token=') && options.nextBrowseResponse
    ? options.nextBrowseResponse
    : options.browseResponse ?? mockBrowseResponse;
}

export function createMockFetch(options: MockFetchOptions = {}) {
  return vi.fn().mockImplementation((url: string) => {
    if (options.shouldFail) {
      return Promise.resolve(createMockJsonResponse({}, 500));
    }

    if (url.includes('/browse')) {
      return Promise.resolve(createMockJsonResponse(browseAnswer(url, options)));
    }

    if (url.includes('/file')) {
      if (options.shouldFailFile) {
        return Promise.resolve(createMockJsonResponse({}, 404));
      }
      return Promise.resolve(createMockJsonResponse(options.fileResponse ?? mockFileContent));
    }

    if (url.includes('/download')) {
      if (options.shouldFailDownload) {
        return Promise.resolve(createMockJsonResponse({}, 500));
      }
      return Promise.resolve(createMockJsonResponse({ download_url: options.downloadUrl ?? 'https://s3.example.com/presigned-url' }));
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}) 
    });
  });
}
