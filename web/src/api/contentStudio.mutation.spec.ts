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
  buildJsonRequestInit,
} from './contentStudio-fixtures';
import {
  buildIdeasDecoderPayload, buildTemplateListDecoderPayload
} from './contentStudioDecoders-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const readIdea = buildApiContentIdea();
const readTemplate = buildApiTemplate();

const signalledReadCases: {
  name: string;
  payload: unknown;
  read: (signal: AbortSignal) => Promise<unknown>;
  expected: unknown;
  url: string;
}[] = [
  {
    name: 'gets ideas from the exact endpoint with the caller abort signal',
    payload: buildIdeasDecoderPayload(readIdea),
    read: (signal) => fetchContentIdeas(signal),
    expected: [readIdea],
    url: 'https://api.test.com/content-studio/ideas',
  },
  {
    name: 'gets history with the exact limit and caller abort signal',
    payload: {
      history: [],
      total_count: 0,
      unviewed_count: 0,
    },
    read: (signal) => fetchContentHistory(7, signal),
    expected: {
      history: [],
      unviewedCount: 0,
    },
    url: 'https://api.test.com/content-studio/history?limit=7',
  },
  {
    name: 'gets encoded content status with the caller abort signal',
    payload: {
      id: 'content/id',
      status: 'generated',
    },
    read: (signal) => fetchContentStatus('content/id', signal),
    expected: 'generated',
    url: 'https://api.test.com/content-studio/status/content%2Fid',
  },
  {
    name: 'gets encoded batch status with the caller abort signal',
    payload: apiBatchStatusResponse,
    read: (signal) => fetchContentBriefBatch('batch/id', signal),
    expected: apiBatchStatusResponse,
    url: 'https://api.test.com/content-studio/batches/batch%2Fid',
  },
  {
    name: 'gets templates from the exact endpoint with the caller abort signal',
    payload: buildTemplateListDecoderPayload([readTemplate]),
    read: (signal) => fetchContentBriefTemplates(signal),
    expected: [readTemplate],
    url: 'https://api.test.com/content-studio/templates',
  },
];

const structuredWriteErrorCases: {
  name: string;
  error: string;
  field: string;
  send: () => Promise<unknown>;
}[] = [
  {
    name: 'preserves a structured generation error from a client response',
    error: 'Generation conflict',
    field: 'idea.id',
    send: () => startContentGeneration(apiGroupBriefIdea),
  },
  {
    name: 'preserves a structured batch error from a client response',
    error: 'Batch conflict',
    field: 'batch_id',
    send: () => startContentBriefBatch(apiBatchRequest),
  },
  {
    name: 'preserves a structured generated-content deletion error',
    error: 'Content is locked',
    field: 'id',
    send: () => deleteGeneratedContent('content-1'),
  },
  {
    name: 'preserves a structured template update error',
    error: 'Template is immutable',
    field: 'id',
    send: () => updateContentBriefTemplate('template-1', { name: 'Changed' }),
  },
  {
    name: 'preserves a structured template deletion error',
    error: 'Template is immutable',
    field: 'id',
    send: () => deleteContentBriefTemplate('template-1'),
  },
];

const templateUpdatePayloadCases: {
  name: string;
  templateId: string;
  changes: Parameters<typeof updateContentBriefTemplate>[1];
  url: string;
  wireBody: Record<string, string>;
}[] = [
  {
    name: 'puts every changed template field with exact wire names and empty strings',
    templateId: 'saved/id',
    changes: {
      name: 'Campaign',
      description: '',
      contentAngle: 'rewrite_pasted_copy',
      promptTemplate: '',
    },
    url: 'https://api.test.com/content-studio/templates/saved%2Fid',
    wireBody: {
      name: 'Campaign',
      description: '',
      content_angle: 'rewrite_pasted_copy',
      prompt_template: '',
    },
  },
  {
    name: 'puts an empty object when no template fields changed',
    templateId: 'saved-1',
    changes: {},
    url: 'https://api.test.com/content-studio/templates/saved-1',
    wireBody: {},
  },
];

beforeEach(() => {
  mockAuthenticatedFetch.mockReset();
});

describe('Content Studio read transport', () => {
  it.each(signalledReadCases)('$name', async ({
    payload, read, expected, url
  }) => {
    const signal = new AbortController().signal;
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(payload));

    const received = await read(signal);

    expect(received).toStrictEqual(expected);
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url, { signal });
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
      buildJsonRequestInit('POST', { id: 'content-1' })
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
  it.each(templateUpdatePayloadCases)('$name', async ({
    templateId, changes, url, wireBody
  }) => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(
      buildApiTemplate({ builtin: false })
    ));

    await updateContentBriefTemplate(templateId, changes);

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url, buildJsonRequestInit('PUT', wireBody));
  });
});

describe('Content Studio structured write errors', () => {
  it.each(structuredWriteErrorCases)('$name', async ({
    error, field, send
  }) => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      error,
      field,
    }, 409));

    const request = send();

    await expect(request).rejects.toMatchObject({
      name: 'ApiRequestError',
      message: error,
      field,
    });
  });
});
