import { vi } from 'vitest';
import type {
  S3BrowseResponse, RawResponseContent 
} from '../types';

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

export const mockFileContent: RawResponseContent = {
  key: 'responses/file1.json',
  content: '{"keyword": "test", "response": "data"}',
  content_type: 'application/json',
  size: 1024,
  last_modified: '2024-01-01T00:00:00Z',
  is_json: true,
};

export function createMockFetch(options: {
  browseResponse?: S3BrowseResponse;
  fileResponse?: RawResponseContent;
  downloadUrl?: string;
  shouldFail?: boolean;
  shouldFailFile?: boolean;
  shouldFailDownload?: boolean;
} = {}) {
  return vi.fn().mockImplementation((url: string) => {
    if (options.shouldFail) {
      return Promise.resolve({
        ok: false,
        status: 500 
      });
    }

    if (url.includes('/browse')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.browseResponse ?? mockBrowseResponse),
      });
    }

    if (url.includes('/file')) {
      if (options.shouldFailFile) {
        return Promise.resolve({
          ok: false,
          status: 404 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.fileResponse ?? mockFileContent),
      });
    }

    if (url.includes('/download')) {
      if (options.shouldFailDownload) {
        return Promise.resolve({
          ok: false,
          status: 500 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ download_url: options.downloadUrl ?? 'https://s3.example.com/presigned-url' }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}) 
    });
  });
}
