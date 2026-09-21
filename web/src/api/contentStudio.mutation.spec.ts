import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  deleteContentBriefTemplate,
  deleteGeneratedContent,
  fetchContentBriefBatch,
  fetchContentBriefTemplates,
  fetchContentHistory,
  fetchContentIdeas,
  fetchContentStatus,
  markContentViewed,
  startContentBriefBatch,
  startContentGeneration,
  updateContentBriefTemplate,
} from './contentStudio';
import { createMockJsonResponse } from '../test/fetchResponses';
import {
  apiBatchRequest,
  apiBatchStatusResponse,
  apiGroupBriefIdea,
  buildApiContentIdea,
  buildApiTemplate,
} from './contentStudio-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

beforeEach(() => {
  mockAuthenticatedFetch.mockReset();
});

describe('Content Studio read transport', () => {
  it('gets ideas from the exact endpoint with the caller abort signal', async () => {
    const idea = buildApiContentIdea();
    const signal = new AbortController().signal;
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      ideas: [idea],
      total_count: 1,
      generated_at: '2026-01-01T00:00:00Z',
    }));

    const received = await fetchContentIdeas(signal);

    expect(received).toStrictEqual([idea]);
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/ideas',
      { signal }
    );
  });

  it('gets history with the exact limit and caller abort signal', async () => {
    const signal = new AbortController().signal;
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      history: [],
      total_count: 0,
      unviewed_count: 0,
    }));

    const received = await fetchContentHistory(7, signal);

    expect(received).toStrictEqual({
      history: [],
      unviewedCount: 0
    });
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/history?limit=7',
      { signal }
    );
  });

  it('gets encoded content status with the caller abort signal', async () => {
    const signal = new AbortController().signal;
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      id: 'content/id',
      status: 'generated',
    }));

    const received = await fetchContentStatus('content/id', signal);

    expect(received).toBe('generated');
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/status/content%2Fid',
      { signal }
    );
  });

  it('gets encoded batch status with the caller abort signal', async () => {
    const signal = new AbortController().signal;
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(apiBatchStatusResponse));

    const received = await fetchContentBriefBatch('batch/id', signal);

    expect(received).toStrictEqual(apiBatchStatusResponse);
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/batches/batch%2Fid',
      { signal }
    );
  });

  it('gets templates from the exact endpoint with the caller abort signal', async () => {
    const signal = new AbortController().signal;
    const template = buildApiTemplate();
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      items: [template],
      count: 1,
    }));

    const received = await fetchContentBriefTemplates(signal);

    expect(received).toStrictEqual([template]);
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/templates',
      { signal }
    );
  });
});

describe('Content Studio history mutation transport', () => {
  it('posts the exact content ID when content is marked viewed', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      success: true,
      id: 'content-1',
    }));

    await markContentViewed('content-1');

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/viewed',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'content-1' }),
        signal: undefined,
      }
    );
  });

  it('deletes the exact encoded generated-content path', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      success: true,
      message: 'Content deleted',
    }));

    await deleteGeneratedContent('content/id');

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/content%2Fid',
      {
        method: 'DELETE',
        signal: undefined,
      }
    );
  });
});

describe('Content Brief template update payloads', () => {
  it('puts every changed template field with exact wire names and empty strings', async () => {
    const template = buildApiTemplate({ builtin: false });
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(template));

    await updateContentBriefTemplate('saved/id', {
      name: 'Campaign',
      description: '',
      contentAngle: 'rewrite_pasted_copy',
      promptTemplate: '',
    });

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/templates/saved%2Fid',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Campaign',
          description: '',
          content_angle: 'rewrite_pasted_copy',
          prompt_template: '',
        }),
        signal: undefined,
      }
    );
  });

  it('puts an empty object when no template fields changed', async () => {
    const template = buildApiTemplate({ builtin: false });
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(template));

    await updateContentBriefTemplate('saved-1', {});

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/templates/saved-1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: undefined,
      }
    );
  });
});

describe('Content Studio structured write errors', () => {
  it('preserves a structured generation error from a client response', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      error: 'Generation conflict',
      field: 'idea.id',
    }, 409));

    const request = startContentGeneration(apiGroupBriefIdea);

    await expect(request).rejects.toMatchObject({
      name: 'ApiRequestError',
      message: 'Generation conflict',
      field: 'idea.id',
    });
  });

  it('preserves a structured batch error from a client response', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      error: 'Batch conflict',
      field: 'batch_id',
    }, 409));

    const request = startContentBriefBatch(apiBatchRequest);

    await expect(request).rejects.toMatchObject({
      name: 'ApiRequestError',
      message: 'Batch conflict',
      field: 'batch_id',
    });
  });

  it('preserves a structured generated-content deletion error', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      error: 'Content is locked',
      field: 'id',
    }, 409));

    const request = deleteGeneratedContent('content-1');

    await expect(request).rejects.toMatchObject({
      name: 'ApiRequestError',
      message: 'Content is locked',
      field: 'id',
    });
  });

  it('preserves a structured template update error', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      error: 'Template is immutable',
      field: 'id',
    }, 409));

    const request = updateContentBriefTemplate('template-1', { name: 'Changed' });

    await expect(request).rejects.toMatchObject({
      name: 'ApiRequestError',
      message: 'Template is immutable',
      field: 'id',
    });
  });

  it('preserves a structured template deletion error', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      error: 'Template is immutable',
      field: 'id',
    }, 409));

    const request = deleteContentBriefTemplate('template-1');

    await expect(request).rejects.toMatchObject({
      name: 'ApiRequestError',
      message: 'Template is immutable',
      field: 'id',
    });
  });
});
