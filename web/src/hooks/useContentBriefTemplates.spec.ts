import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { buildApiTemplate } from '../api/contentStudio-fixtures';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import { waitForLoaded } from '../test/loadedHook';
import {
  useContentBriefTemplates,
  type ContentBriefTemplateMutationOutcome,
  type UseContentBriefTemplatesReturn,
} from './useContentBriefTemplates';
import {
  buildTemplateDraft,
  builtinCreateTemplate,
  builtinRewriteTemplate,
  expectedOrderedTemplateIds,
  renderLoadedContentBriefTemplates,
  renderPendingContentBriefTemplates,
  respondTemplateNotFound,
  savedBeachTemplate,
  savedUrbanTemplate,
  serveTemplateList,
  settleTemplateList,
  templateIds,
  templateListJsonResponse,
} from './useContentBriefTemplates-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

beforeEach(() => {
  vi.clearAllMocks();
  serveTemplateList([builtinCreateTemplate, builtinRewriteTemplate, savedUrbanTemplate]);
});

/** Renders the loaded hook and runs `mutation` against a 404 "Template not found" answer. */
async function renderAfterTemplateNotFound(
  mutation: (hook: UseContentBriefTemplatesReturn) => Promise<ContentBriefTemplateMutationOutcome>
): Promise<ContentBriefTemplateMutationOutcome> {
  const { result } = await renderLoadedContentBriefTemplates();
  respondTemplateNotFound();
  return act(() => mutation(result.current));
}

describe('useContentBriefTemplates', () => {
  it.each([
    {
      testName: 'keeps built-ins in API order before saved templates sorted by name',
      listed: [builtinCreateTemplate, builtinRewriteTemplate, savedUrbanTemplate, savedBeachTemplate],
      expectedIds: expectedOrderedTemplateIds,
    },
    {
      testName: 'sorts case-equivalent saved names by ID after built-ins',
      listed: [
        builtinCreateTemplate,
        buildApiTemplate({
          id: 'saved-z',
          name: 'campaign',
          builtin: false,
        }),
        buildApiTemplate({
          id: 'saved-a',
          name: 'Campaign',
          builtin: false,
        }),
      ],
      expectedIds: ['builtin-create-new-landing-page', 'saved-a', 'saved-z'],
    },
  ])('$testName', async ({
    listed, expectedIds
  }) => {
    serveTemplateList(listed);

    const { result } = await renderLoadedContentBriefTemplates();

    expect(templateIds(result.current.templates)).toStrictEqual(expectedIds);
  });

  it('inserts a created template among saved templates by name', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(
      savedBeachTemplate,
      201
    ));

    const outcome = await act(() => result.current.create(buildTemplateDraft({ name: 'Beach campaign' })));

    expect(outcome).toStrictEqual({
      success: true,
      message: 'Template "Beach campaign" saved',
      template: savedBeachTemplate,
    });
    expect(templateIds(result.current.templates)).toStrictEqual(expectedOrderedTemplateIds);
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
    expect(templateIds(result.current.templates)).toStrictEqual([
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

    await act(() => result.current.create(buildTemplateDraft()));
    await settleTemplateList(deferred, [builtinCreateTemplate]);

    expect(result.current.templates).toStrictEqual([campaign]);
    expect(result.current.loading).toBe(false);
  });

  it('does not update state when the initial response arrives after unmount', async () => {
    const {
      deferred, result, unmount
    } = renderPendingContentBriefTemplates();
    const templatesBeforeUnmount = result.current.templates;

    unmount();
    await settleTemplateList(deferred, [builtinCreateTemplate]);

    expect(templatesBeforeUnmount).toStrictEqual([]);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it('reports the server outcome without changing templates when create fails', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      error: 'name is required',
      field: 'name',
    }, 400));

    const outcome = await act(() => result.current.create(buildTemplateDraft({ name: '' })));

    expect(outcome.success).toBe(false);
    expect(outcome.message).toBe('name is required');
    expect(result.current.templates).toHaveLength(3);
  });

  it('starts in loading state while the initial template request is pending', async () => {
    const {
      deferred, result, unmount
    } = renderPendingContentBriefTemplates();

    expect(result.current.loading).toBe(true);
    unmount();
    await settleTemplateList(deferred, []);
  });

  it('clears a refresh error after a later refresh succeeds', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 500));
    const { result } = await renderLoadedContentBriefTemplates();

    expect(result.current.error).toBe('Content generation failed');
    mockAuthenticatedFetch.mockResolvedValueOnce(templateListJsonResponse([builtinCreateTemplate]));
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
    deferred.resolve(templateListJsonResponse([builtinCreateTemplate]));

    await waitForLoaded(result);
  });

  it('returns the server outcome when an unknown template update fails', async () => {
    const outcome = await renderAfterTemplateNotFound((hook) => hook.update('unknown', { name: 'Changed' }));

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Template not found',
    });
  });

  it('returns the server outcome when an unknown template delete fails', async () => {
    const outcome = await renderAfterTemplateNotFound((hook) => hook.remove('unknown'));

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
