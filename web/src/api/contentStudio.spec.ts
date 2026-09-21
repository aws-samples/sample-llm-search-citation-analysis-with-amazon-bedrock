import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  createContentBriefTemplate,
  deleteContentBriefTemplate,
  fetchContentBriefBatch,
  fetchContentBriefTemplates,
  fetchContentHistory,
  fetchContentIdeas,
  startContentBriefBatch,
  startContentGeneration,
  updateContentBriefTemplate,
} from './contentStudio';
import {
  apiBatchRequest,
  apiBatchStartResponse,
  apiBatchStatusResponse,
  apiGroupBriefIdea,
  buildApiContentIdea,
  buildApiHistoryItem,
  buildApiMissingBatchStatusResponse,
  buildApiTemplate,
} from './contentStudio-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Content Studio read decoders', () => {
  it('returns every idea when the ideas response is valid', async () => {
    const ideas = [
      buildApiContentIdea(),
      buildApiContentIdea({
        id: 'seasonal-1',
        type: 'seasonal_content',
        content_angle: 'seasonal',
      }),
    ];
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      ideas,
      total_count: 2,
      generated_at: '2026-01-01T00:00:00Z',
    }));

    const received = await fetchContentIdeas();

    expect(received).toStrictEqual(ideas);
  });

  it('rejects the complete ideas response when one nested idea is malformed', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      ideas: [buildApiContentIdea(), { id: 'broken' }],
      total_count: 2,
      generated_at: '2026-01-01T00:00:00Z',
    }));

    await expect(fetchContentIdeas()).rejects.toMatchObject({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid content idea',
    });
  });

  it('normalizes stored numeric strings and empty pending content in history', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      history: [{
        ...buildApiHistoryItem(),
        competitor_sources_used: '0',
        generated_content: {},
        batch_size: '2',
        batch_position: '1',
      }],
      total_count: 1,
      unviewed_count: 0,
    }));

    const received = await fetchContentHistory();

    expect(received.history).toStrictEqual([{
      ...buildApiHistoryItem({ generated_content: undefined }),
      content_warning: undefined,
      error_message: undefined,
      batch_id: undefined,
      batch_size: 2,
      batch_position: 1,
      keyword_id: undefined,
    }]);
    expect(received.unviewedCount).toBe(0);
  });

  it('supplies stable presentation defaults when a legacy history row omits them', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      history: [{
        id: 'legacy',
        idea_id: 'idea-legacy',
        keyword: 'Legacy keyword',
        status: 'generated',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        generated_content: {},
      }],
      total_count: 1,
      unviewed_count: 0,
    }));

    const received = await fetchContentHistory();

    expect(received.history).toStrictEqual([{
      id: 'legacy',
      keyword: 'Legacy keyword',
      idea_title: 'Legacy keyword',
      content_angle: '',
      competitor_sources_used: 0,
      status: 'generated',
      viewed: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      generated_content: undefined,
      content_warning: undefined,
      error_message: undefined,
      batch_id: undefined,
      batch_size: undefined,
      batch_position: undefined,
      keyword_id: undefined,
    }]);
  });
});

describe('Content Studio generation transport', () => {
  it('posts the exact combined Content Brief payload to the single endpoint', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      success: true,
      id: 'content-1',
      status: 'pending',
      keyword: 'Alpha keyword',
    }));

    await startContentGeneration(apiGroupBriefIdea);

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: apiGroupBriefIdea }),
        signal: undefined,
      }
    );
  });

  it('posts one exact durable batch payload to the batch endpoint', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(
      apiBatchStartResponse,
      202
    ));

    const received = await startContentBriefBatch(apiBatchRequest);

    expect(received).toStrictEqual(apiBatchStartResponse);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/generate-batch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiBatchRequest),
        signal: undefined,
      }
    );
  });

  it('returns every persisted child when a batch is accepted', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(
      apiBatchStartResponse,
      202
    ));

    const received = await startContentBriefBatch(apiBatchRequest);

    expect(received.accepted_count).toBe(2);
    expect(received.failed_count).toBe(0);
    expect(received.children.map((child) => child.status)).toStrictEqual([
      'pending', 'pending'
    ]);
  });

  it('rejects a legacy self-invoke 503 instead of treating it as batch acceptance', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(
      { error: 'Could not dispatch batch children' },
      503,
      'Service Unavailable'
    ));

    await expect(startContentBriefBatch(apiBatchRequest)).rejects.toMatchObject({
      name: 'ApiRequestError',
      statusCode: 503,
    });
  });

  it('rejects a start response for a different batch ID', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      ...apiBatchStartResponse,
      batch_id: 'different-batch',
    }, 202));

    await expect(startContentBriefBatch(apiBatchRequest)).rejects.toMatchObject({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid batch response',
    });
  });

  it('encodes the batch ID and decodes terminal partial status', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      ...apiBatchStatusResponse,
      batch_id: 'batch/id',
    }));

    const received = await fetchContentBriefBatch('batch/id');

    expect(received).toStrictEqual(apiBatchStatusResponse);
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/batches/batch%2Fid',
      { signal: undefined }
    );
  });

  it('decodes a missing child tombstone without dropping its manifest position', async () => {
    const response = buildApiMissingBatchStatusResponse();
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(response));

    const received = await fetchContentBriefBatch('batch/id');

    expect(received).toStrictEqual(response);
    expect(received.children.map((child) => child.batch_position)).toStrictEqual([1, 2]);
  });

  it('rejects a status response for a different batch ID', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(apiBatchStatusResponse));

    await expect(fetchContentBriefBatch('requested-batch')).rejects.toMatchObject({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid batch status response',
    });
  });
});

describe('Content Brief template transport', () => {
  it('returns built-ins first and saved templates after strict list decoding', async () => {
    const templates = [
      buildApiTemplate(),
      buildApiTemplate({
        id: 'saved-1',
        name: 'Campaign',
        builtin: false,
        created_by: 'user-1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ];
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      items: templates,
      count: 2,
    }));

    const received = await fetchContentBriefTemplates();

    expect(received).toStrictEqual(templates);
  });

  it('rejects a template list containing a malformed item', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      items: [buildApiTemplate(), { id: 'broken' }],
      count: 2,
    }));

    await expect(fetchContentBriefTemplates()).rejects.toMatchObject({
      name: 'InvalidContentStudioResponseError',
      message: 'Content Studio API returned an invalid Content Brief template',
    });
  });

  it('posts the exact fields when a saved template is created', async () => {
    const template = buildApiTemplate({
      id: 'saved-1',
      name: 'Campaign',
      description: 'Reusable campaign brief',
      builtin: false,
    });
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(template, 201));

    await createContentBriefTemplate({
      name: 'Campaign',
      description: 'Reusable campaign brief',
      contentAngle: 'create_new_landing_page',
      promptTemplate: 'Create for {scope}.',
    });

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/templates',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Campaign',
          description: 'Reusable campaign brief',
          content_angle: 'create_new_landing_page',
          prompt_template: 'Create for {scope}.',
        }),
        signal: undefined,
      }
    );
  });

  it('puts only changed fields to the encoded saved-template path', async () => {
    const template = buildApiTemplate({
      id: 'saved/id',
      name: 'Renamed',
      builtin: false,
    });
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(template));

    await updateContentBriefTemplate('saved/id', { name: 'Renamed' });

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/templates/saved%2Fid',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
        signal: undefined,
      }
    );
  });

  it('deletes one encoded saved-template path', async () => {
    mockAuthenticatedFetch.mockResolvedValue(
      createMockJsonResponse({ message: 'Template deleted successfully' })
    );

    await deleteContentBriefTemplate('saved/id');

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/content-studio/templates/saved%2Fid',
      {
        method: 'DELETE',
        signal: undefined,
      }
    );
  });

  it('preserves structured field guidance when template creation is rejected', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      error: 'name is required',
      field: 'name',
    }, 400));

    const request = createContentBriefTemplate({
      name: '',
      description: '',
      contentAngle: 'create_new_landing_page',
      promptTemplate: 'Create for {scope}.',
    });

    await expect(request).rejects.toMatchObject({
      name: 'ApiRequestError',
      message: 'name is required',
      field: 'name',
    });
  });
});
