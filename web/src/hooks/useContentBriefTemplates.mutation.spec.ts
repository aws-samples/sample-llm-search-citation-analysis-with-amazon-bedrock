import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import { act } from '@testing-library/react';
import { createMockJsonResponse } from '../test/fetchResponses';
import { waitForLoaded } from '../test/loadedHook';
import type { useContentBriefTemplates } from './useContentBriefTemplates';
import {
  buildTemplateDraft,
  builtinCreateTemplate,
  prepareTemplateHookResponses,
  renderLoadedContentBriefTemplates,
  renderPendingContentBriefTemplates,
  savedUrbanTemplate,
  settleTemplateList,
  templateListJsonResponse,
} from './useContentBriefTemplates-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import {
  deferNextTwoAuthenticatedFetches, mockAuthenticatedFetch
} from '../test/infrastructureMock';

type ContentBriefTemplatesHook = ReturnType<typeof useContentBriefTemplates>;

const mutationErrorCases = [
  {
    testName: 'logs the exact saving context when template creation fails',
    invokeMutation: (hook: ContentBriefTemplatesHook) => hook.create(buildTemplateDraft()),
    logContext: '[content] Error saving Content Brief template:',
  },
  {
    testName: 'logs the exact updating context when template update fails',
    invokeMutation: (hook: ContentBriefTemplatesHook) => hook.update(
      savedUrbanTemplate.id,
      { name: 'Changed' }
    ),
    logContext: '[content] Error updating Content Brief template:',
  },
  {
    testName: 'logs the exact deleting context when template deletion fails',
    invokeMutation: (hook: ContentBriefTemplatesHook) => hook.remove(savedUrbanTemplate.id),
    logContext: '[content] Error deleting Content Brief template:',
  },
];

beforeEach(prepareTemplateHookResponses);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useContentBriefTemplates operational errors', () => {
  it('logs the exact loading context when a refresh fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 500));

    await renderLoadedContentBriefTemplates();

    expect(consoleError).toHaveBeenCalledWith(
      '[content] Error loading Content Brief templates:',
      expect.objectContaining({ statusCode: 500 })
    );
  });

  it.each(mutationErrorCases)('$testName', async ({
    invokeMutation, logContext 
  }) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const { result } = await renderLoadedContentBriefTemplates();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({}, 500));

    await act(() => invokeMutation(result.current));

    expect(consoleError).toHaveBeenCalledWith(
      logContext,
      expect.objectContaining({ statusCode: 500 })
    );
  });
});

describe('useContentBriefTemplates overlapping operation state', () => {
  it('keeps loading true when an older mutation settles during a newer refresh', async () => {
    const { result } = await renderLoadedContentBriefTemplates();
    const [mutationResponse, refreshResponse] = deferNextTwoAuthenticatedFetches();
    const pendingMutation = {
      promise: Promise.resolve({
        success: false,
        message: ''
      })
    };
    act(() => {
      pendingMutation.promise = result.current.update(
        savedUrbanTemplate.id,
        { name: 'Older update' }
      );
    });
    act(() => { void result.current.refresh(); });

    mutationResponse.resolve(createMockJsonResponse({
      ...savedUrbanTemplate,
      name: 'Older update',
    }));
    await act(() => pendingMutation.promise);

    expect(result.current.loading).toBe(true);
    refreshResponse.resolve(templateListJsonResponse([builtinCreateTemplate, savedUrbanTemplate]));
    await waitForLoaded(result);
  });

  it('ignores a refresh result that settles after the hook unmounts', async () => {
    const {
      deferred, result, unmount
    } = renderPendingContentBriefTemplates();

    unmount();
    await settleTemplateList(deferred, [builtinCreateTemplate]);

    expect(result.current.templates).toStrictEqual([]);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });
});
