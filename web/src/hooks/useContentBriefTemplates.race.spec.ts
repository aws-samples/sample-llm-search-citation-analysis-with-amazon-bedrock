import {
  describe, expect, it, vi
} from 'vitest';
import {
  act, waitFor
} from '@testing-library/react';
import { buildApiTemplate } from '../api/contentStudio-fixtures';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import {
  builtinCreateTemplate,
  prepareTemplateHookResponses,
  renderLoadedContentBriefTemplates,
  savedUrbanTemplate,
  templateListResponse,
} from './useContentBriefTemplates-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

describe('useContentBriefTemplates request ordering', () => {
  it('sorts saved templates by name when ID order conflicts', async () => {
    prepareTemplateHookResponses();
    const alpha = buildApiTemplate({
      id: 'saved-z',
      name: 'Alpha',
      builtin: false,
    });
    const zebra = buildApiTemplate({
      id: 'saved-a',
      name: 'Zebra',
      builtin: false,
    });
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(
      templateListResponse([builtinCreateTemplate, zebra, alpha])
    ));

    const { result } = await renderLoadedContentBriefTemplates();

    expect(result.current.templates[1]?.id).toBe('saved-z');
    expect(result.current.templates[2]?.id).toBe('saved-a');
  });

  it('uses the content error message when a save fails with a server error', async () => {
    prepareTemplateHookResponses();
    const { result } = await renderLoadedContentBriefTemplates();
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({}, 500));

    const outcome = await act(() => result.current.create({
      name: 'Campaign',
      description: '',
      contentAngle: 'create_new_landing_page',
      promptTemplate: 'Create for {scope}.',
    }));

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Content generation failed',
    });
  });

  it('ignores an older refresh error after a later refresh succeeds', async () => {
    prepareTemplateHookResponses();
    const { result } = await renderLoadedContentBriefTemplates();
    const older = createDeferredResponse();
    mockAuthenticatedFetch
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(createMockJsonResponse(
        templateListResponse([builtinCreateTemplate])
      ));
    const olderRequest = { promise: Promise.resolve() };
    act(() => {
      olderRequest.promise = result.current.refresh();
    });

    await act(() => result.current.refresh());
    older.resolve(createMockJsonResponse({}, 500));
    await act(() => olderRequest.promise);

    expect(result.current.error).toBeNull();
    expect(result.current.templates).toStrictEqual([builtinCreateTemplate]);
  });

  it('keeps loading true until the newest concurrent refresh settles', async () => {
    prepareTemplateHookResponses();
    const { result } = await renderLoadedContentBriefTemplates();
    const older = createDeferredResponse();
    const newer = createDeferredResponse();
    mockAuthenticatedFetch
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const requests = {
      older: Promise.resolve(),
      newer: Promise.resolve(),
    };
    act(() => {
      requests.older = result.current.refresh();
      requests.newer = result.current.refresh();
    });
    older.resolve(createMockJsonResponse(templateListResponse([savedUrbanTemplate])));
    await act(() => requests.older);

    expect(result.current.loading).toBe(true);
    newer.resolve(createMockJsonResponse(templateListResponse([builtinCreateTemplate])));
    await act(() => requests.newer);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });
});
