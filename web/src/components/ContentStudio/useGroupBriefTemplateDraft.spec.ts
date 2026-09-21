import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, waitFor
} from '@testing-library/react';
import {
  buildContentBriefTemplate,
  buildContentBriefTemplatesHookResult,
} from './GroupBriefForm-fixtures';
import { GROUP_BRIEF_DEFAULT_TEMPLATES } from './GroupBriefForm-source';
import type { useGroupBriefTemplateDraft } from './useGroupBriefTemplateDraft';
import {
  buildGroupBriefTemplateDraftHookResult,
  createDeferredTemplateMutation,
  createdGroupBriefTemplate,
  mockUseContentBriefTemplates,
  prepareGroupBriefTemplateDraftMocks,
  renderGroupBriefTemplateDraft,
  renderGroupBriefTemplateDraftWithHooks,
  renderSelectedSavedTemplateDraft,
  renderTemplateDraftWithCreateOutcome,
  renderTemplateDraftWithDeferredCreate,
  savedGroupBriefTemplate,
} from './useGroupBriefTemplateDraft-fixtures';

vi.mock('../../hooks/useContentBriefTemplates', () => ({ useContentBriefTemplates: vi.fn() }));

const SAVED_TEMPLATE = savedGroupBriefTemplate;
const CREATED_TEMPLATE = createdGroupBriefTemplate;
const SAVED_TEMPLATE_DRAFT = {
  name: SAVED_TEMPLATE.name,
  description: SAVED_TEMPLATE.description,
  prompt: SAVED_TEMPLATE.prompt_template,
};

const createMutationCases = [
  {
    testName: 'exposes the returned template state when a create succeeds',
    outcome: {
      success: true,
      message: 'Template "Created template" saved',
      template: CREATED_TEMPLATE,
    },
    expectedState: {
      selectedTemplateId: CREATED_TEMPLATE.id,
      draftName: CREATED_TEMPLATE.name,
      notice: {
        success: true,
        message: 'Template "Created template" saved',
      },
    },
  },
  {
    testName: 'preserves the built-in state when a create fails',
    outcome: {
      success: false,
      message: 'Save failed',
    },
    expectedState: {
      selectedTemplateId: 'builtin-create-new-landing-page',
      draftName: 'Create new landing page',
      notice: {
        success: false,
        message: 'Save failed',
      },
    },
  },
];

const deleteMutationCases = [
  {
    testName: 'keeps a saved template when deletion confirmation is cancelled',
    confirmed: false,
    expectedRemoveCalls: [],
    expectedTemplateId: SAVED_TEMPLATE.id,
  },
  {
    testName: 'returns to the mode built-in after a saved template is deleted',
    confirmed: true,
    expectedRemoveCalls: [[SAVED_TEMPLATE.id]],
    expectedTemplateId: 'builtin-create-new-landing-page',
  },
];

const updateStateCases = [
  {
    testName: 'selects the returned template after a successful update',
    outcome: {
      success: true,
      message: 'Template updated',
      template: CREATED_TEMPLATE,
    },
    expectedState: {
      selectedTemplateId: CREATED_TEMPLATE.id,
      draft: {
        name: CREATED_TEMPLATE.name,
        description: CREATED_TEMPLATE.description,
        prompt: CREATED_TEMPLATE.prompt_template,
      },
      notice: {
        success: true,
        message: 'Template updated',
      },
    },
  },
  {
    testName: 'reports a failed update without replacing the selected template',
    outcome: {
      success: false,
      message: 'Update failed',
    },
    expectedState: {
      selectedTemplateId: SAVED_TEMPLATE.id,
      draft: SAVED_TEMPLATE_DRAFT,
      notice: {
        success: false,
        message: 'Update failed',
      },
    },
  },
  {
    testName: 'keeps the current template when a successful update omits a template snapshot',
    outcome: {
      success: true,
      message: 'Update accepted',
    },
    expectedState: {
      selectedTemplateId: SAVED_TEMPLATE.id,
      draft: SAVED_TEMPLATE_DRAFT,
      notice: {
        success: true,
        message: 'Update accepted',
      },
    },
  },
];

type TemplateDraftResult = ReturnType<typeof useGroupBriefTemplateDraft>;

const noticeSelectionCases = [
  {
    testName: 'clears an earlier mutation notice when a different template is selected',
    selectTemplate: (draft: TemplateDraftResult) => draft.select(SAVED_TEMPLATE.id),
    expectedTemplateId: SAVED_TEMPLATE.id,
  },
  {
    testName: 'clears an earlier notice when a built-in is selected',
    selectTemplate: (draft: TemplateDraftResult) => draft.selectBuiltin('rewrite_pasted_copy'),
    expectedTemplateId: 'builtin-rewrite-pasted-copy',
  },
];

const undeletableSelectionCases = [
  {
    testName: 'does not confirm or delete when the selected template is built-in',
    templates: [buildContentBriefTemplate()],
  },
  {
    testName: 'does not confirm deletion when the selected ID has no template',
    templates: [],
  },
];

beforeEach(prepareGroupBriefTemplateDraftMocks);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useGroupBriefTemplateDraft selection', () => {
  it('uses empty metadata and the local default while templates are loading', () => {
    const { result } = renderGroupBriefTemplateDraftWithHooks({
      templates: [],
      loading: true,
    });

    expect(result.current.draft).toStrictEqual({
      name: '',
      description: '',
      prompt: GROUP_BRIEF_DEFAULT_TEMPLATES.create_new_landing_page,
    });
    expect(result.current.selectedTemplateId).toBe('builtin-create-new-landing-page');
  });

  it('hydrates the complete selected template when templates load later', () => {
    mockUseContentBriefTemplates.mockReturnValue(buildContentBriefTemplatesHookResult({
      templates: [],
      loading: true,
    }));
    const {
      result, rerender
    } = renderGroupBriefTemplateDraft();
    mockUseContentBriefTemplates.mockReturnValue(
      buildContentBriefTemplatesHookResult({ templates: [buildContentBriefTemplate()] })
    );

    rerender();

    expect(result.current.draft).toStrictEqual({
      name: 'Create new landing page',
      description: 'Create a complete landing page from the selected keyword scope.',
      prompt: GROUP_BRIEF_DEFAULT_TEMPLATES.create_new_landing_page,
    });
  });

  it('switches to the exact saved template when it is selected', () => {
    const { result } = renderSelectedSavedTemplateDraft();

    expect(result.current.selectedTemplateId).toBe(SAVED_TEMPLATE.id);
    expect(result.current.draft).toStrictEqual(SAVED_TEMPLATE_DRAFT);
  });

  it('keeps the current template when an unknown ID is selected', () => {
    const { result } = renderGroupBriefTemplateDraft();
    const draftBeforeSelection = result.current.draft;

    act(() => result.current.select('unknown'));

    expect(result.current.selectedTemplateId).toBe('builtin-create-new-landing-page');
    expect(result.current.draft).toStrictEqual(draftBeforeSelection);
  });

  it('selects the matching built-in snapshot when generation mode changes', () => {
    const { result } = renderGroupBriefTemplateDraft();

    act(() => result.current.selectBuiltin('rewrite_pasted_copy'));

    expect(result.current.selectedTemplateId).toBe('builtin-rewrite-pasted-copy');
    expect(result.current.draft.prompt).toBe(
      GROUP_BRIEF_DEFAULT_TEMPLATES.rewrite_pasted_copy
    );
  });

  it('uses the local mode default when the matching built-in is unavailable', () => {
    const { result } = renderGroupBriefTemplateDraftWithHooks({ templates: [] });

    act(() => result.current.selectBuiltin('rewrite_pasted_copy'));

    expect(result.current.draft).toStrictEqual({
      name: '',
      description: '',
      prompt: GROUP_BRIEF_DEFAULT_TEMPLATES.rewrite_pasted_copy,
    });
  });

  it('uses the requested built-in when the hook starts in rewrite mode', () => {
    const { result } = renderGroupBriefTemplateDraft('rewrite_pasted_copy');

    expect(result.current.selectedTemplateId).toBe('builtin-rewrite-pasted-copy');
    expect(result.current.draft.prompt).toBe(
      GROUP_BRIEF_DEFAULT_TEMPLATES.rewrite_pasted_copy
    );
  });
});

describe('useGroupBriefTemplateDraft dirty state', () => {
  it('becomes dirty when only the template name changes', () => {
    const { result } = renderGroupBriefTemplateDraft();

    act(() => result.current.setName('Changed name'));

    expect(result.current.dirty).toBe(true);
  });

  it('becomes dirty when only the description changes', () => {
    const { result } = renderGroupBriefTemplateDraft();

    act(() => result.current.setDescription('Changed description'));

    expect(result.current.dirty).toBe(true);
  });

  it('becomes dirty when only the prompt changes', () => {
    const { result } = renderGroupBriefTemplateDraft();

    act(() => result.current.setPrompt('Changed {scope}'));

    expect(result.current.dirty).toBe(true);
  });

  it('restores clean state when changes are reset', () => {
    const { result } = renderGroupBriefTemplateDraft();
    act(() => result.current.setName('Changed name'));

    act(() => result.current.reset());

    expect(result.current.dirty).toBe(false);
    expect(result.current.draft.name).toBe('Create new landing page');
  });
});

describe('useGroupBriefTemplateDraft exact state', () => {
  it('starts with saving false when no mutation is active', () => {
    const { result } = renderGroupBriefTemplateDraft();

    expect(result.current.saving).toBe(false);
  });

  it('changes only the name when setName is called', () => {
    const { result } = renderGroupBriefTemplateDraft();
    const original = result.current.draft;

    act(() => result.current.setName('Renamed template'));

    expect(result.current.draft).toStrictEqual({
      ...original,
      name: 'Renamed template',
    });
  });

  it('changes only the description when setDescription is called', () => {
    const { result } = renderGroupBriefTemplateDraft();
    const original = result.current.draft;

    act(() => result.current.setDescription('Changed description'));

    expect(result.current.draft).toStrictEqual({
      ...original,
      description: 'Changed description',
    });
  });

  it('changes only the prompt when setPrompt is called', () => {
    const { result } = renderGroupBriefTemplateDraft();
    const original = result.current.draft;

    act(() => result.current.setPrompt('Changed prompt for {scope}.'));

    expect(result.current.draft).toStrictEqual({
      ...original,
      prompt: 'Changed prompt for {scope}.',
    });
  });
});

describe('useGroupBriefTemplateDraft create mutations', () => {
  it('keeps saving true until a create mutation settles', async () => {
    const {
      deferred, result
    } = renderTemplateDraftWithDeferredCreate();

    act(() => { void result.current.saveAsNew(); });
    expect(result.current.saving).toBe(true);
    deferred.resolve({
      success: true,
      message: 'Template saved',
      template: SAVED_TEMPLATE,
    });

    await waitFor(() => {
      expect(result.current.saving).toBe(false);
    });
  });

  it.each(createMutationCases)('$testName', async ({
    outcome, expectedState 
  }) => {
    const { result } = renderTemplateDraftWithCreateOutcome(outcome);

    await act(() => result.current.saveAsNew());

    expect({
      selectedTemplateId: result.current.selectedTemplateId,
      draftName: result.current.draft.name,
      notice: result.current.notice,
    }).toStrictEqual(expectedState);
  });

  it('creates with the latest exact draft after fields change', async () => {
    const {
      create, result
    } = renderTemplateDraftWithCreateOutcome({
      success: false,
      message: 'Captured draft',
    });
    act(() => {
      result.current.setName('Latest name');
      result.current.setDescription('Latest description');
      result.current.setPrompt('Latest prompt for {scope}.');
    });

    await act(() => result.current.saveAsNew());

    expect(create).toHaveBeenCalledWith({
      name: 'Latest name',
      description: 'Latest description',
      contentAngle: 'create_new_landing_page',
      promptTemplate: 'Latest prompt for {scope}.',
    });
  });

  it('allows a second create after the first create settles', async () => {
    const {
      create, result
    } = renderTemplateDraftWithCreateOutcome({
      success: false,
      message: 'Save failed',
    });

    await act(() => result.current.saveAsNew());
    await act(() => result.current.saveAsNew());

    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('useGroupBriefTemplateDraft update outcomes', () => {
  it('sends the selected ID and exact current draft when a saved template is updated', async () => {
    const update = vi.fn().mockResolvedValue({
      success: true,
      message: 'Template updated',
      template: CREATED_TEMPLATE,
    });
    const { result } = renderSelectedSavedTemplateDraft({ update });
    act(() => {
      result.current.setName('Requested name');
      result.current.setDescription('Requested description');
      result.current.setPrompt('Requested prompt for {scope}.');
    });

    await act(() => result.current.updateSelected());

    expect(update).toHaveBeenCalledWith(SAVED_TEMPLATE.id, {
      name: 'Requested name',
      description: 'Requested description',
      contentAngle: 'create_new_landing_page',
      promptTemplate: 'Requested prompt for {scope}.',
    });
  });

  it.each(updateStateCases)('$testName', async ({
    outcome, expectedState 
  }) => {
    const update = vi.fn().mockResolvedValue(outcome);
    const { result } = renderSelectedSavedTemplateDraft({ update });

    await act(() => result.current.updateSelected());

    expect({
      selectedTemplateId: result.current.selectedTemplateId,
      draft: result.current.draft,
      notice: result.current.notice,
    }).toStrictEqual(expectedState);
  });
});

describe('useGroupBriefTemplateDraft race and idempotency outcomes', () => {
  it('starts only one create when save is requested twice before settlement', async () => {
    const {
      create, deferred, result
    } = renderTemplateDraftWithDeferredCreate();
    const pending = { promise: Promise.resolve() };

    act(() => {
      pending.promise = result.current.saveAsNew();
      void result.current.saveAsNew();
    });

    expect(create).toHaveBeenCalledTimes(1);
    deferred.resolve({
      success: true,
      message: 'Template saved',
      template: CREATED_TEMPLATE,
    });
    await pending.promise;
  });

  it('keeps a later mode selection when an earlier create settles', async () => {
    const {
      deferred, result
    } = renderTemplateDraftWithDeferredCreate();
    act(() => { void result.current.saveAsNew(); });

    act(() => result.current.selectBuiltin('rewrite_pasted_copy'));
    deferred.resolve({
      success: true,
      message: 'Old create finished',
      template: CREATED_TEMPLATE,
    });
    await waitFor(() => {
      expect(result.current.saving).toBe(false);
    });

    expect({
      selectedTemplateId: result.current.selectedTemplateId,
      prompt: result.current.draft.prompt,
      notice: result.current.notice,
    }).toStrictEqual({
      selectedTemplateId: 'builtin-rewrite-pasted-copy',
      prompt: GROUP_BRIEF_DEFAULT_TEMPLATES.rewrite_pasted_copy,
      notice: null,
    });
  });

  it('settles a pending create after unmount without starting another request', async () => {
    const {
      create, deferred, result, unmount
    } = renderTemplateDraftWithDeferredCreate();
    const pending = { promise: Promise.resolve() };
    act(() => {
      pending.promise = result.current.saveAsNew();
    });

    unmount();
    deferred.resolve({
      success: true,
      message: 'Template saved',
      template: CREATED_TEMPLATE,
    });
    await pending.promise;

    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each(noticeSelectionCases)('$testName', async ({
    selectTemplate,
    expectedTemplateId,
  }) => {
    const { result } = renderTemplateDraftWithCreateOutcome({
      success: false,
      message: 'Save failed',
    });
    await act(() => result.current.saveAsNew());

    act(() => selectTemplate(result.current));

    expect(result.current.notice).toBeNull();
    expect(result.current.selectedTemplateId).toBe(expectedTemplateId);
  });

  it('clears an earlier notice while a later create is pending', async () => {
    const deferred = createDeferredTemplateMutation();
    const create = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        message: 'First failed'
      })
      .mockReturnValueOnce(deferred.promise);
    const { result } = renderGroupBriefTemplateDraftWithHooks({ create });
    await act(() => result.current.saveAsNew());

    act(() => { void result.current.saveAsNew(); });

    expect(result.current.notice).toBeNull();
    expect(result.current.saving).toBe(true);
    deferred.resolve({
      success: false,
      message: 'Second failed'
    });
    await waitFor(() => {
      expect(result.current.saving).toBe(false);
    });
  });
});

describe('useGroupBriefTemplateDraft deletion outcomes', () => {
  it.each(undeletableSelectionCases)('$testName', async ({ templates }) => {
    const remove = vi.fn();
    const confirmSpy = vi.spyOn(globalThis, 'confirm');
    const { result } = renderGroupBriefTemplateDraftWithHooks({
      templates,
      remove 
    });

    await act(() => result.current.deleteSelected());

    expect({
      confirmationCalls: confirmSpy.mock.calls,
      removalCalls: remove.mock.calls,
    }).toStrictEqual({
      confirmationCalls: [],
      removalCalls: [],
    });
  });

  it.each(deleteMutationCases)('$testName', async ({
    confirmed,
    expectedRemoveCalls,
    expectedTemplateId,
  }) => {
    const remove = vi.fn().mockResolvedValue({
      success: true,
      message: 'Template deleted',
    });
    vi.spyOn(globalThis, 'confirm').mockReturnValue(confirmed);
    const { result } = renderSelectedSavedTemplateDraft({ remove });

    await act(() => result.current.deleteSelected());

    expect(remove.mock.calls).toStrictEqual(expectedRemoveCalls);
    expect(result.current.selectedTemplateId).toBe(expectedTemplateId);
  });

  it('keeps a saved template selected when deletion fails', async () => {
    const remove = vi.fn().mockResolvedValue({
      success: false,
      message: 'Delete failed',
    });
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const { result } = renderSelectedSavedTemplateDraft({ remove });

    await act(() => result.current.deleteSelected());

    expect({
      selectedTemplateId: result.current.selectedTemplateId,
      notice: result.current.notice,
    }).toStrictEqual({
      selectedTemplateId: SAVED_TEMPLATE.id,
      notice: {
        success: false,
        message: 'Delete failed',
      },
    });
  });

  it('uses the selected template name in the deletion confirmation', async () => {
    const remove = vi.fn().mockResolvedValue({
      success: true,
      message: 'Template deleted',
    });
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    const { result } = renderSelectedSavedTemplateDraft({ remove });

    await act(() => result.current.deleteSelected());

    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete template "Saved campaign"? Existing briefs keep their prompt snapshot.'
    );
  });
});

describe('useGroupBriefTemplateDraft refreshed closures', () => {
  it('selects a template that appears after the initial render', () => {
    mockUseContentBriefTemplates.mockReturnValue(buildContentBriefTemplatesHookResult({templates: [buildContentBriefTemplate()],}));
    const {
      result, rerender
    } = renderGroupBriefTemplateDraft();
    mockUseContentBriefTemplates.mockReturnValue(buildGroupBriefTemplateDraftHookResult());
    rerender();

    act(() => result.current.select(SAVED_TEMPLATE.id));

    expect(result.current.selectedTemplateId).toBe(SAVED_TEMPLATE.id);
    expect(result.current.draft.prompt).toBe(SAVED_TEMPLATE.prompt_template);
  });

  it('uses a server built-in that appears after the initial render', () => {
    const rewriteTemplate = buildContentBriefTemplate({
      id: 'builtin-rewrite-pasted-copy',
      name: 'Server rewrite',
      description: 'Server rewrite description',
      content_angle: 'rewrite_pasted_copy',
      prompt_template: 'Server rewrite prompt for {scope}.',
    });
    mockUseContentBriefTemplates.mockReturnValue(
      buildContentBriefTemplatesHookResult({ templates: [] })
    );
    const {
      result, rerender
    } = renderGroupBriefTemplateDraft();
    mockUseContentBriefTemplates.mockReturnValue(
      buildContentBriefTemplatesHookResult({ templates: [rewriteTemplate] })
    );
    rerender();

    act(() => result.current.selectBuiltin('rewrite_pasted_copy'));

    expect(result.current.selectedTemplateId).toBe(rewriteTemplate.id);
    expect(result.current.draft).toStrictEqual({
      name: 'Server rewrite',
      description: 'Server rewrite description',
      prompt: 'Server rewrite prompt for {scope}.',
    });
  });

  it('resets to the latest selected template snapshot', () => {
    const { result } = renderSelectedSavedTemplateDraft();
    act(() => result.current.setName('Temporary name'));

    act(() => result.current.reset());

    expect(result.current.draft).toStrictEqual(SAVED_TEMPLATE_DRAFT);
  });

  it('keeps fallback state when reset has no selected template', () => {
    const { result } = renderGroupBriefTemplateDraftWithHooks({ templates: [] });
    const original = result.current.draft;

    act(() => result.current.reset());

    expect(result.current.draft).toStrictEqual(original);
  });
});
