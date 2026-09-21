import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { buildApiTemplate } from '../api/contentStudio-fixtures';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import { useContentBriefTemplates } from './useContentBriefTemplates';
import {
  builtinCreateTemplate,
  builtinRewriteTemplate,
  expectedOrderedTemplateIds,
  renderLoadedContentBriefTemplates,
  respondTemplateNotFound,
  savedBeachTemplate,
  savedUrbanTemplate,
  templateListResponse,
} from './useContentBriefTemplates-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(templateListResponse([
    builtinCreateTemplate,
    builtinRewriteTemplate,
    savedUrbanTemplate,
  ])));
});

describe('useContentBriefTemplates', () => {
  it('keeps built-ins in API order before saved templates sorted by name', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(templateListResponse([
      builtinCreateTemplate,
      builtinRewriteTemplate,
      savedUrbanTemplate,
      savedBeachTemplate,
    ])));

    const { result } = await renderLoadedContentBriefTemplates();

    expect(result.current.templates.map((template) => template.id)).toStrictEqual(
      expectedOrderedTemplateIds
    );
  });

  it('inserts a created template among saved templates by name', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(
      savedBeachTemplate,
      201
    ));

    const outcome = await act(() => result.current.create({
      name: 'Beach campaign',
      description: '',
      contentAngle: 'create_new_landing_page',
      promptTemplate: 'Create for {scope}.',
    }));

    expect(outcome).toStrictEqual({
      success: true,
      message: 'Template "Beach campaign" saved',
      template: savedBeachTemplate,
    });
    expect(result.current.templates.map((template) => template.id)).toStrictEqual(
      expectedOrderedTemplateIds
    );
  });

  it('replaces and re-sorts a template with the exact update response', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    const updated = {
      ...savedUrbanTemplate,
      name: 'Airport campaign',
      prompt_template: 'Updated prompt for {scope}.',
      updated_at: '2026-01-02T00:00:00Z',
    };
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(updated));

    const outcome = await act(() => result.current.update(
      savedUrbanTemplate.id,
      { name: 'Airport campaign' }
    ));

    expect(outcome).toStrictEqual({
      success: true,
      message: 'Template "Airport campaign" updated',
      template: updated,
    });
    expect(result.current.templates).toStrictEqual([
      builtinCreateTemplate,
      builtinRewriteTemplate,
      updated,
    ]);
  });

  it('removes a saved template after the delete response succeeds', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({ message: 'Template deleted successfully' }));

    const outcome = await act(() => result.current.remove(savedUrbanTemplate.id));

    expect(outcome.success).toBe(true);
    expect(outcome.message).toBe('Template deleted');
    expect(result.current.templates.map((template) => template.id)).toStrictEqual([
      'builtin-create-new-landing-page',
      'builtin-rewrite-pasted-copy',
    ]);
  });

  it('rejects update and delete mutations for built-in templates locally', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    const callsBeforeMutations = mockAuthenticatedFetch.mock.calls.length;

    const updated = await act(() => result.current.update(
      builtinCreateTemplate.id,
      { name: 'Changed' }
    ));
    const deleted = await act(() => result.current.remove(builtinCreateTemplate.id));

    expect([updated.success, deleted.success]).toStrictEqual([false, false]);
    expect(updated.message).toBe(
      'Built-in templates cannot be updated; save a copy instead.'
    );
    expect(deleted.message).toBe(
      'Built-in templates cannot be deleted; save a copy instead.'
    );
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(callsBeforeMutations);
  });

  it('ignores an older refresh response after a later create completes', async () => {
    const deferred = createDeferredResponse();
    const campaign = buildApiTemplate({
      id: 'saved-campaign',
      name: 'Campaign',
      builtin: false,
    });
    mockAuthenticatedFetch
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValueOnce(createMockJsonResponse(campaign, 201));
    const { result } = renderHook(() => useContentBriefTemplates());

    await act(() => result.current.create({
      name: 'Campaign',
      description: '',
      contentAngle: 'create_new_landing_page',
      promptTemplate: 'Create for {scope}.',
    }));
    deferred.resolve(createMockJsonResponse(templateListResponse([builtinCreateTemplate])));
    await act(async () => {
      await deferred.promise;
    });

    expect(result.current.templates).toStrictEqual([campaign]);
    expect(result.current.loading).toBe(false);
  });

  it('does not update state when the initial response arrives after unmount', async () => {
    const deferred = createDeferredResponse();
    mockAuthenticatedFetch.mockReturnValue(deferred.promise);
    const {
      result, unmount
    } = renderHook(() => useContentBriefTemplates());
    const templatesBeforeUnmount = result.current.templates;

    unmount();
    deferred.resolve(createMockJsonResponse(templateListResponse([builtinCreateTemplate])));
    await act(async () => {
      await deferred.promise;
    });

    expect(templatesBeforeUnmount).toStrictEqual([]);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it('reports the server outcome without changing templates when create fails', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      error: 'name is required',
      field: 'name',
    }, 400));

    const outcome = await act(() => result.current.create({
      name: '',
      description: '',
      contentAngle: 'create_new_landing_page',
      promptTemplate: 'Create for {scope}.',
    }));

    expect(outcome.success).toBe(false);
    expect(outcome.message).toBe('name is required');
    expect(result.current.templates).toHaveLength(3);
  });

  it('starts in loading state while the initial template request is pending', async () => {
    const deferred = createDeferredResponse();
    mockAuthenticatedFetch.mockReturnValue(deferred.promise);
    const {
      result, unmount
    } = renderHook(() => useContentBriefTemplates());

    expect(result.current.loading).toBe(true);
    unmount();
    deferred.resolve(createMockJsonResponse(templateListResponse([])));
    await deferred.promise;
  });

  it('sorts case-equivalent saved names by ID after built-ins', async () => {
    const lower = buildApiTemplate({
      id: 'saved-z',
      name: 'campaign',
      builtin: false,
    });
    const upper = buildApiTemplate({
      id: 'saved-a',
      name: 'Campaign',
      builtin: false,
    });
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(templateListResponse([
      builtinCreateTemplate,
      lower,
      upper,
    ])));

    const { result } = await renderLoadedContentBriefTemplates();

    expect(result.current.templates.map((template) => template.id)).toStrictEqual([
      'builtin-create-new-landing-page',
      'saved-a',
      'saved-z',
    ]);
  });

  it('clears a refresh error after a later refresh succeeds', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 500));
    const { result } = await renderLoadedContentBriefTemplates();

    expect(result.current.error).toBe('Content generation failed');
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(
      templateListResponse([builtinCreateTemplate])
    ));
    await act(() => result.current.refresh());

    expect(result.current.error).toBeNull();
    expect(result.current.templates).toStrictEqual([builtinCreateTemplate]);
  });

  it('keeps loading true until a manual refresh settles', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    const deferred = createDeferredResponse();
    mockAuthenticatedFetch.mockReturnValueOnce(deferred.promise);

    act(() => { void result.current.refresh(); });
    expect(result.current.loading).toBe(true);
    deferred.resolve(createMockJsonResponse(templateListResponse([builtinCreateTemplate])));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('returns the server outcome when an unknown template update fails', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    respondTemplateNotFound();

    const outcome = await act(() => result.current.update('unknown', { name: 'Changed' }));

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Template not found',
    });
  });

  it('returns the server outcome when an unknown template delete fails', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    respondTemplateNotFound();

    const outcome = await act(() => result.current.remove('unknown'));

    expect(outcome.success).toBe(false);
    expect(outcome.message).toBe('Template not found');
    expect(mockAuthenticatedFetch).toHaveBeenLastCalledWith(
      'https://api.test.com/content-studio/templates/unknown',
      {
        method: 'DELETE',
        signal: undefined,
      }
    );
  });

  it('keeps the later update when an older update response arrives last', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    const deferred = createDeferredResponse();
    const older = {
      ...savedUrbanTemplate,
      prompt_template: 'Older response {scope}',
    };
    const later = {
      ...savedUrbanTemplate,
      prompt_template: 'Later response {scope}',
    };
    mockAuthenticatedFetch
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValueOnce(createMockJsonResponse(later));
    const firstMutation = {
      promise: Promise.resolve({
        success: false,
        message: 'not started',
      }),
    };
    act(() => {
      firstMutation.promise = result.current.update(
        savedUrbanTemplate.id,
        { promptTemplate: 'First edit {scope}' }
      );
    });

    const laterOutcome = await act(() => result.current.update(
      savedUrbanTemplate.id,
      { promptTemplate: 'Second edit {scope}' }
    ));
    deferred.resolve(createMockJsonResponse(older));
    await act(() => firstMutation.promise);

    expect(laterOutcome.template).toStrictEqual(later);
    expect(result.current.templates[2]).toStrictEqual(later);
    expect(result.current.loading).toBe(false);
  });
});
