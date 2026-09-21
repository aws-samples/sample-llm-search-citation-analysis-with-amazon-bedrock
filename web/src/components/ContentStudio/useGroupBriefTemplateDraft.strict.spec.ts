import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import { act } from '@testing-library/react';
import { renderReplayedTemplateCreate } from './useGroupBriefTemplateDraft-strict-fixtures';
import {
  createdGroupBriefTemplate,
  prepareGroupBriefTemplateDraftMocks,
  renderGroupBriefTemplateDraftWithHooksInStrictMode,
  renderSelectedSavedTemplateDraftInStrictMode,
  savedGroupBriefTemplate,
} from './useGroupBriefTemplateDraft-fixtures';

vi.mock('../../hooks/useContentBriefTemplates', () => ({ useContentBriefTemplates: vi.fn() }));

beforeEach(prepareGroupBriefTemplateDraftMocks);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useGroupBriefTemplateDraft StrictMode lifecycle', () => {
  it('settles a saved template create after setup-cleanup-setup replay', async () => {
    const create = vi.fn().mockResolvedValue({
      success: true,
      message: 'Template saved',
      template: createdGroupBriefTemplate,
    });
    const { result } = renderGroupBriefTemplateDraftWithHooksInStrictMode({ create });

    await act(() => result.current.saveAsNew());

    expect(result.current.selectedTemplateId).toBe(createdGroupBriefTemplate.id);
    expect(result.current.notice).toStrictEqual({
      success: true,
      message: 'Template saved',
    });
    expect(result.current.saving).toBe(false);
  });

  it('settles a saved template update after setup-cleanup-setup replay', async () => {
    const update = vi.fn().mockResolvedValue({
      success: true,
      message: 'Template updated',
      template: createdGroupBriefTemplate,
    });
    const { result } = renderSelectedSavedTemplateDraftInStrictMode({ update });

    await act(() => result.current.updateSelected());

    expect(result.current.selectedTemplateId).toBe(createdGroupBriefTemplate.id);
    expect(result.current.notice).toStrictEqual({
      success: true,
      message: 'Template updated',
    });
    expect(result.current.saving).toBe(false);
  });

  it('returns to the built-in after delete settles through effect replay', async () => {
    const remove = vi.fn().mockResolvedValue({
      success: true,
      message: 'Template deleted',
    });
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const { result } = renderSelectedSavedTemplateDraftInStrictMode({ remove });

    await act(() => result.current.deleteSelected());

    expect(result.current.selectedTemplateId).toBe('builtin-create-new-landing-page');
    expect(result.current.notice).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it('keeps replayed create active when the discarded create settles first', async () => {
    const {
      create,
      firstCreate,
      secondCreate,
      result,
    } = renderReplayedTemplateCreate();

    expect(create).toHaveBeenCalledTimes(2);
    firstCreate.resolve({
      success: true,
      message: 'Discarded create finished',
      template: savedGroupBriefTemplate,
    });
    await act(() => firstCreate.promise);
    expect({
      saving: result.current.saving,
      selectedTemplateId: result.current.selectedTemplateId,
    }).toStrictEqual({
      saving: true,
      selectedTemplateId: 'builtin-create-new-landing-page',
    });

    secondCreate.resolve({
      success: true,
      message: 'Replayed create finished',
      template: createdGroupBriefTemplate,
    });
    await act(() => secondCreate.promise);
    expect({
      saving: result.current.saving,
      selectedTemplateId: result.current.selectedTemplateId,
      notice: result.current.notice,
    }).toStrictEqual({
      saving: false,
      selectedTemplateId: createdGroupBriefTemplate.id,
      notice: {
        success: true,
        message: 'Replayed create finished',
      },
    });
  });
});
