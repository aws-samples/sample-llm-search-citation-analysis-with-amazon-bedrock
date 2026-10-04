import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { act } from '@testing-library/react';
import { renderReplayedTemplateCreate } from './useGroupBriefTemplateDraft-strict-fixtures';
import {
  buildTemplateSavedOutcome,
  createdGroupBriefTemplate,
  prepareGroupBriefTemplateDraftMocks,
  renderSelectedTemplateDraftForDeletion,
  renderSelectedTemplateDraftWithUpdateOutcome,
  renderTemplateDraftWithCreateOutcome,
  savedGroupBriefTemplate,
} from './useGroupBriefTemplateDraft-fixtures';

vi.mock('../../hooks/useContentBriefTemplates', () => ({ useContentBriefTemplates: vi.fn() }));

const strictMutationSettlementCases = [
  {
    testName: 'settles a saved template create after setup-cleanup-setup replay',
    message: 'Template saved',
    settle: async () => {
      const { result } = renderTemplateDraftWithCreateOutcome(
        buildTemplateSavedOutcome(createdGroupBriefTemplate),
        { strict: true }
      );
      await act(() => result.current.saveAsNew());
      return result;
    },
  },
  {
    testName: 'settles a saved template update after setup-cleanup-setup replay',
    message: 'Template updated',
    settle: async () => {
      const { result } = renderSelectedTemplateDraftWithUpdateOutcome(
        {
          success: true,
          message: 'Template updated',
          template: createdGroupBriefTemplate,
        },
        { strict: true }
      );
      await act(() => result.current.updateSelected());
      return result;
    },
  },
];

beforeEach(prepareGroupBriefTemplateDraftMocks);

describe('useGroupBriefTemplateDraft StrictMode lifecycle', () => {
  it.each(strictMutationSettlementCases)('$testName', async ({
    message, settle
  }) => {
    const result = await settle();

    expect(result.current.selectedTemplateId).toBe(createdGroupBriefTemplate.id);
    expect(result.current.notice).toStrictEqual({
      success: true,
      message,
    });
    expect(result.current.saving).toBe(false);
  });

  it('returns to the built-in after delete settles through effect replay', async () => {
    const { result } = renderSelectedTemplateDraftForDeletion({
      confirmed: true,
      strict: true,
    });

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
