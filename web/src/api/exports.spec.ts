import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { createMockJsonResponse } from '../test/fetchResponses';
import { buildExportSummary } from '../types/domain/exports-fixtures';
import {
  deleteExport, exportParams, fetchDownloadUrl, isExportActive, isUnseenFinish, listExports, markExportSeen, requestParams, startExport
} from './exports';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const READY = buildExportSummary({
  status: 'ready',
  download_url: 'https://bucket.s3.amazonaws.com/exports/u/exp-coruna/citations.xlsx?X-Amz-Signature=a',
  download_expires_at: '2026-11-06T09:16:00Z',
});

describe('exportParams', () => {
  it('drops limit, offset, next_token and every list cursor', () => {
    expect(exportParams({
      group_id: 'g1',
      limit: 25,
      offset: 50,
      next_token: 'n',
      keyword_summaries_next_token: 'k',
    })).toStrictEqual({ group_id: 'g1' });
  });

  it('drops unset filters and stringifies the rest in key order', () => {
    expect(exportParams({
      sort: 'citation_count',
      min_citations: 2,
      market_id: null,
      url_contains: '',
      provider: undefined,
      include_response: true,
    })).toStrictEqual({
      include_response: 'true',
      min_citations: '2',
      sort: 'citation_count',
    });
  });
});

describe('requestParams', () => {
  it('is the view GET query without its paging params', () => {
    expect(requestParams({ params: new URLSearchParams('group_id=g1&view=keywords&next_token=t&market_id=es') })).toStrictEqual({
      group_id: 'g1',
      market_id: 'es',
      view: 'keywords',
    });
  });

  it('is null before the view made its request', () => {
    expect(requestParams(null)).toBeNull();
  });
});

describe('export status helpers', () => {
  it.each(['queued', 'running'] as const)('counts a %s export as active', (status) => {
    expect(isExportActive(buildExportSummary({ status }))).toBe(true);
  });

  it.each(['ready', 'failed', 'cancelled'] as const)('counts a %s export as finished', (status) => {
    expect(isExportActive(buildExportSummary({ status }))).toBe(false);
  });

  it('counts a ready export the owner has not seen as an unseen finish', () => {
    expect(isUnseenFinish(buildExportSummary({ status: 'ready' }))).toBe(true);
  });

  it('does not count a seen or cancelled export as an unseen finish', () => {
    expect([
      isUnseenFinish(buildExportSummary({
        status: 'ready',
        notified: true,
      })),
      isUnseenFinish(buildExportSummary({ status: 'cancelled' })),
    ]).toStrictEqual([false, false]);
  });
});

describe('startExport', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('posts the view, its params and the format', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ export: buildExportSummary({ status: 'queued' }) }, 202));

    await startExport({
      view: 'citations',
      params: { group_id: 'g1' },
      format: 'csv',
    });

    const [url, init] = mockAuthenticatedFetch.mock.calls[0];
    expect([String(url), init?.method, init?.body]).toStrictEqual([
      'https://api.test.com/exports',
      'POST',
      JSON.stringify({
        view: 'citations',
        params: { group_id: 'g1' },
        format: 'csv',
      }),
    ]);
  });

  it('resolves the queued export of the 202 answer', async () => {
    const queued = buildExportSummary({ status: 'queued' });
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ export: queued }, 202));

    await expect(startExport({
      view: 'citations',
      params: {},
      format: 'xlsx',
    })).resolves.toStrictEqual(queued);
  });

  it('rejects with the server message when the caller has too many running exports', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ error: 'At most 5 exports may run at once' }, 429));

    await expect(startExport({
      view: 'citations',
      params: {},
      format: 'xlsx',
    })).rejects.toThrow('At most 5 exports may run at once');
  });

  it('rejects with the validation message of a 400', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ error: 'Unknown group_id' }, 400));

    await expect(startExport({
      view: 'citations',
      params: { group_id: 'x' },
      format: 'xlsx',
    })).rejects.toThrow('Unknown group_id');
  });
});

describe('listExports', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('reads the page the token points at', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      exports: [],
      next_token: null,
    }));

    await listExports('tok-2');

    expect(String(mockAuthenticatedFetch.mock.calls[0][0])).toBe('https://api.test.com/exports?next_token=tok-2');
  });

  it('rejects a list with a malformed export', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ exports: [{ export_id: 'e' }] }));

    await expect(listExports(null)).rejects.toThrow('The exports list answer is malformed');
  });
});

describe('fetchDownloadUrl', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('resolves the fresh presigned URL of a ready export', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ export: READY }));

    await expect(fetchDownloadUrl('exp-coruna')).resolves.toBe(READY.download_url);
  });

  it('rejects a download link that is not https', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      export: {
        ...READY,
        download_url: 'javascript:alert(1)',
      },
    }));

    await expect(fetchDownloadUrl('exp-coruna')).rejects.toThrow('The export has no download link yet');
  });

  it('rejects an export that is still running', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ export: buildExportSummary() }));

    await expect(fetchDownloadUrl('exp-coruna')).rejects.toThrow('The export has no download link yet');
  });
});

describe('deleteExport and markExportSeen', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('resolves a 204 delete without a body', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(deleteExport('exp/1')).resolves.toBeUndefined();
  });

  it('sends the delete to the encoded export id', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteExport('exp/1');

    expect(String(mockAuthenticatedFetch.mock.calls[0][0])).toBe('https://api.test.com/exports/exp%2F1');
  });

  it('posts seen to the export', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ export: READY }));

    await markExportSeen('exp-coruna');

    expect(String(mockAuthenticatedFetch.mock.calls[0][0])).toBe('https://api.test.com/exports/exp-coruna/seen');
  });
});
