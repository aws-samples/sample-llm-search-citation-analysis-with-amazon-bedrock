import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, screen, waitFor, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useContentBriefTemplates } from '../../hooks/useContentBriefTemplates';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import * as groupBriefSource from './GroupBriefForm-source';
import {
  GROUP_BRIEF_BATCH_LIMIT_GUIDANCE,
  GROUP_BRIEF_DEFAULT_TEMPLATES,
} from './GroupBriefForm-source';
import {
  buildContentBriefKeywordScope,
  buildContentBriefTemplate,
  buildContentBriefTemplatesHookResult,
  buildKeyword,
  buildKeywordGroupHookResult,
  buildNumberedKeywords,
  confirmGroupBrief,
  fillImproveUrlBrief,
  renderGroupBriefForm,
  reviewGroupBrief,
  selectGroupForBrief,
  selectKeywordsForBrief,
  selectPerKeywordStrategy,
  submitGroupBrief,
} from './GroupBriefForm-fixtures';

vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));
vi.mock('../../hooks/useContentBriefTemplates', () => ({ useContentBriefTemplates: vi.fn() }));

const mockUseKeywordGroups = vi.mocked(useKeywordGroups);
const mockUseContentBriefTemplates = vi.mocked(useContentBriefTemplates);

beforeEach(() => {
  mockUseKeywordGroups.mockReturnValue(buildKeywordGroupHookResult());
  mockUseContentBriefTemplates.mockReturnValue(buildContentBriefTemplatesHookResult());
  vi.spyOn(groupBriefSource, 'createGroupBriefIdeaId')
    .mockReturnValueOnce('brief-stable-id')
    .mockReturnValue('brief-next-id');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GroupBriefForm scope', () => {
  it('shows only group and keyword modes for the Content Brief target scope', () => {
    renderGroupBriefForm();

    expect(screen.getByRole('form', { name: 'Content Brief' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Keywords' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'All' })).not.toBeInTheDocument();
  });

  it('previews every active group member when group mode is selected', async () => {
    renderGroupBriefForm();

    await selectGroupForBrief();

    expect(screen.getByText('Generic Group: 2 active keywords')).toBeInTheDocument();
    expect(screen.getByText('Alpha keyword')).toBeInTheDocument();
    expect(screen.getByText('Beta keyword')).toBeInTheDocument();
    expect(screen.queryByText('Inactive keyword')).not.toBeInTheDocument();
  });

  it('sends only the group scope when a combined group brief is confirmed', async () => {
    const formProps = renderGroupBriefForm();
    await selectGroupForBrief();

    await submitGroupBrief();

    expect(formProps.onGenerate).toHaveBeenCalledWith({
      id: 'brief-stable-id',
      type: 'group_brief',
      scope: {
        mode: 'groups',
        group_ids: ['group-1'],
      },
      content_angle: 'create_new_landing_page',
      landing_url: '',
      current_copy: '',
      template_id: 'builtin-create-new-landing-page',
      prompt_template: GROUP_BRIEF_DEFAULT_TEMPLATES.create_new_landing_page,
      output_language: 'English',
    });
  });

  it('sends arbitrary active keyword IDs without requiring a group', async () => {
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupHookResult({ groups: [] }));
    const formProps = renderGroupBriefForm();
    await selectKeywordsForBrief(['Alpha keyword', 'Other group keyword']);

    await submitGroupBrief();

    expect(formProps.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ scope: buildContentBriefKeywordScope(['keyword-1', 'keyword-other']) }));
    expect(formProps.onGenerateBatch).not.toHaveBeenCalledWith(expect.anything());
  });

  it('treats one selected keyword as an ordinary combined brief', async () => {
    const formProps = renderGroupBriefForm();
    await selectKeywordsForBrief(['Alpha keyword']);

    await submitGroupBrief();

    expect(formProps.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ scope: buildContentBriefKeywordScope(['keyword-1']) }));
    expect(screen.queryByText(/keyword group is required/iu)).not.toBeInTheDocument();
  });

  it('preserves all 50 selected keyword IDs in a combined request', async () => {
    const keywords = buildNumberedKeywords(50);
    const formProps = renderGroupBriefForm({ keywords });
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }));

    await submitGroupBrief();

    expect(screen.getByText('Selected keywords: 50 active keywords')).toBeInTheDocument();
    expect(formProps.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ scope: buildContentBriefKeywordScope(keywords.map((keyword) => keyword.id)) }));
  });

  it('reports all 51 group members instead of truncating the selected group', async () => {
    const keywords = buildNumberedKeywords(51);
    const formProps = renderGroupBriefForm({ keywords });

    await selectGroupForBrief();
    await reviewGroupBrief();

    expect(screen.getByText('Generic Group: 51 active keywords')).toBeInTheDocument();
    expect(screen.getByText(/selected scope has more than 50 active keywords/iu)).toBeInTheDocument();
    expect(formProps.onGenerate).not.toHaveBeenCalledWith(expect.anything());
  });

  it('excludes inactive and missing-status keywords from selection', () => {
    renderGroupBriefForm({
      keywords: [
        buildKeyword({ status: 'inactive' }),
        buildKeyword({
          id: 'missing-status',
          keyword: 'Missing status',
          status: undefined,
        }),
      ],
    });

    expect(screen.queryByText('Alpha keyword')).not.toBeInTheDocument();
    expect(screen.queryByText('Missing status')).not.toBeInTheDocument();
    expect(screen.getByText('Selected keywords: 0 active keywords')).toBeInTheDocument();
  });
});

describe('GroupBriefForm strategy', () => {
  it('starts one batch request for three selected keywords after confirmation', async () => {
    const formProps = renderGroupBriefForm();
    await selectKeywordsForBrief(['Alpha keyword', 'Beta keyword', 'Other group keyword']);
    await selectPerKeywordStrategy();

    await reviewGroupBrief();
    await confirmGroupBrief(3);

    expect(formProps.onGenerateBatch).toHaveBeenCalledWith({
      batch_id: 'brief-stable-id',
      scope: buildContentBriefKeywordScope([
        'keyword-1', 'keyword-2', 'keyword-other'
      ]),
      brief: {
        content_angle: 'create_new_landing_page',
        landing_url: '',
        current_copy: '',
        template_id: 'builtin-create-new-landing-page',
        prompt_template: GROUP_BRIEF_DEFAULT_TEMPLATES.create_new_landing_page,
        output_language: 'English',
      },
    });
    expect(formProps.onGenerate).not.toHaveBeenCalledWith(expect.anything());
  });

  it('shows the exact paid-call count before a three-keyword batch starts', async () => {
    const formProps = renderGroupBriefForm();
    await selectKeywordsForBrief(['Alpha keyword', 'Beta keyword', 'Other group keyword']);
    await selectPerKeywordStrategy();

    expect(screen.getByText('Estimated paid model calls: 3')).toBeInTheDocument();
    await reviewGroupBrief();

    expect(screen.getByText(
      'This will start 3 background jobs and make 3 paid model calls.'
    )).toBeInTheDocument();
    expect(formProps.onGenerateBatch).not.toHaveBeenCalledWith(expect.anything());
  });

  it('blocks a per-keyword batch above ten with actionable guidance', async () => {
    const keywords = Array.from({ length: 11 }, (_, index) => buildKeyword({
      id: `keyword-${index + 1}`,
      keyword: `Keyword ${index + 1}`,
    }));
    renderGroupBriefForm({ keywords });
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
    await selectPerKeywordStrategy();

    expect(screen.getByText(GROUP_BRIEF_BATCH_LIMIT_GUIDANCE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review generation' })).toBeDisabled();
    expect(screen.getByText('Estimated paid model calls: 11')).toBeInTheDocument();
  });

  it('explains equivalence when one keyword uses the per-keyword strategy', async () => {
    renderGroupBriefForm();
    await selectKeywordsForBrief(['Alpha keyword']);
    await selectPerKeywordStrategy();

    expect(screen.getByText(/combined option is equivalent/iu)).toBeInTheDocument();
    expect(screen.getByText('Estimated paid model calls: 1')).toBeInTheDocument();
  });
});

describe('GroupBriefForm content fields', () => {
  it('requires an http or https URL when improve current URL mode is selected', async () => {
    renderGroupBriefForm();
    await selectGroupForBrief();
    await userEvent.click(screen.getByRole('radio', { name: /Improve current URL/u }));

    await reviewGroupBrief();

    expect(screen.getByText('Enter a valid http or https landing URL.')).toBeInTheDocument();
  });

  it('sends the trimmed landing URL for improve current URL mode', async () => {
    const formProps = renderGroupBriefForm();
    await fillImproveUrlBrief('https://example.com/page');

    await submitGroupBrief();

    expect(formProps.onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      content_angle: 'improve_current_url',
      landing_url: 'https://example.com/page',
      current_copy: '',
      template_id: 'builtin-improve-current-url',
    }));
  });

  it('requires non-whitespace copy when rewrite pasted copy mode is selected', async () => {
    renderGroupBriefForm();
    await selectGroupForBrief();
    await userEvent.click(screen.getByRole('radio', { name: /Rewrite pasted copy/u }));
    await userEvent.type(screen.getByLabelText('Current copy'), '   ');

    await reviewGroupBrief();

    expect(screen.getByText('Enter the current copy to rewrite.')).toBeInTheDocument();
  });

  it('rejects the legacy group placeholder for a selected-keyword scope', async () => {
    const formProps = renderGroupBriefForm();
    await selectKeywordsForBrief(['Alpha keyword']);
    fireEvent.change(
      screen.getByLabelText('Prompt template'),
      { target: { value: 'Create {group} from {keywords}.' } }
    );

    await reviewGroupBrief();

    expect(screen.getByText(
      'Prompt template cannot use {group} with selected keywords. Use {scope} instead.'
    )).toBeInTheDocument();
    expect(formProps.onGenerate).not.toHaveBeenCalledWith(expect.anything());
  });
});

describe('GroupBriefForm templates', () => {
  it('keeps built-in templates immutable', () => {
    renderGroupBriefForm();

    expect(screen.queryByRole('button', { name: 'Update template' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete template' })).toBeNull();
    expect(screen.getByText(/Built-in templates cannot be edited or deleted/iu)).toBeInTheDocument();
  });

  it('resets dirty fields to the selected template snapshot', async () => {
    renderGroupBriefForm();
    fireEvent.change(
      screen.getByLabelText('Template name'),
      { target: { value: 'Changed name' } }
    );
    fireEvent.change(
      screen.getByLabelText('Prompt template'),
      { target: { value: 'Changed {scope}' } }
    );

    expect(screen.getByText(/Edited — generation uses this exact snapshot/iu)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset changes' }));

    expect(screen.getByLabelText('Template name')).toHaveValue('Create new landing page');
    expect(screen.getByLabelText('Prompt template')).toHaveValue(
      GROUP_BRIEF_DEFAULT_TEMPLATES.create_new_landing_page
    );
  });

  it('saves the current name description mode and prompt as a new template', async () => {
    const create = vi.fn().mockResolvedValue({
      success: true,
      message: 'Template "Campaign" saved',
      template: buildContentBriefTemplate({
        id: 'saved-campaign',
        name: 'Campaign',
        description: 'Reusable campaign brief',
        prompt_template: 'Campaign prompt for {scope}',
        builtin: false,
      }),
    });
    mockUseContentBriefTemplates.mockReturnValue(buildContentBriefTemplatesHookResult({ create }));
    renderGroupBriefForm();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Campaign' } });
    fireEvent.change(
      screen.getByLabelText('Description'),
      { target: { value: 'Reusable campaign brief' } }
    );
    fireEvent.change(
      screen.getByLabelText('Prompt template'),
      { target: { value: 'Campaign prompt for {scope}' } }
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save as new template' }));

    expect(create).toHaveBeenCalledWith({
      name: 'Campaign',
      description: 'Reusable campaign brief',
      contentAngle: 'create_new_landing_page',
      promptTemplate: 'Campaign prompt for {scope}',
    });
    expect(await screen.findByText('Template "Campaign" saved')).toBeInTheDocument();
  });

  it('offers update and delete controls only for a saved template', async () => {
    const saved = buildContentBriefTemplate({
      id: 'saved-template',
      name: 'Saved template',
      builtin: false,
      created_by: 'user-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    const templates = [...buildContentBriefTemplatesHookResult().templates, saved];
    mockUseContentBriefTemplates.mockReturnValue(
      buildContentBriefTemplatesHookResult({ templates })
    );
    renderGroupBriefForm();

    await userEvent.selectOptions(screen.getByLabelText('Saved template'), saved.id);

    expect(screen.getByRole('button', { name: 'Update template' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete template' })).toBeEnabled();
  });

  it('uses the exact server snapshot returned by a later template update', async () => {
    const saved = buildContentBriefTemplate({
      id: 'saved-template',
      name: 'Saved template',
      prompt_template: 'Original {scope}',
      builtin: false,
    });
    const updated = {
      ...saved,
      prompt_template: 'Authoritative updated {scope}',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const update = vi.fn().mockResolvedValue({
      success: true,
      message: 'Template "Saved template" updated',
      template: updated,
    });
    mockUseContentBriefTemplates.mockReturnValue(buildContentBriefTemplatesHookResult({
      templates: [...buildContentBriefTemplatesHookResult().templates, saved],
      update,
    }));
    const formProps = renderGroupBriefForm();
    await userEvent.selectOptions(screen.getByLabelText('Saved template'), saved.id);
    fireEvent.change(
      screen.getByLabelText('Prompt template'),
      { target: { value: 'Requested edit {scope}' } }
    );
    await userEvent.click(screen.getByRole('button', { name: 'Update template' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Prompt template')).toHaveValue(
        'Authoritative updated {scope}'
      );
    });
    await selectKeywordsForBrief(['Alpha keyword']);

    await submitGroupBrief();

    expect(formProps.onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      template_id: 'saved-template',
      prompt_template: 'Authoritative updated {scope}',
    }));
  });

  it('deletes a saved template only after confirmation', async () => {
    const saved = buildContentBriefTemplate({
      id: 'saved-template',
      name: 'Saved template',
      builtin: false,
    });
    const remove = vi.fn().mockResolvedValue({
      success: true,
      message: 'Template deleted',
    });
    mockUseContentBriefTemplates.mockReturnValue(buildContentBriefTemplatesHookResult({
      templates: [...buildContentBriefTemplatesHookResult().templates, saved],
      remove,
    }));
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    renderGroupBriefForm();
    await userEvent.selectOptions(screen.getByLabelText('Saved template'), saved.id);

    await userEvent.click(screen.getByRole('button', { name: 'Delete template' }));

    expect(globalThis.confirm).toHaveBeenCalledWith(
      'Delete template "Saved template"? Existing briefs keep their prompt snapshot.'
    );
    expect(remove).toHaveBeenCalledWith('saved-template');
  });
});

describe('GroupBriefForm request state', () => {
  it('shows loading state when keyword groups are loading', () => {
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupHookResult({ loading: true }));

    renderGroupBriefForm();

    expect(screen.getByText('Loading keyword groups...')).toBeInTheDocument();
  });

  it('associates always-visible fields with group-brief identities', () => {
    renderGroupBriefForm();

    const fields = ['Output language'].map((label) => (
      screen.getByLabelText<HTMLSelectElement>(label)
    ));

    expect(fields.map((field) => ({
      id: field.id,
      labelFor: field.labels?.[0]?.htmlFor,
      name: field.name,
    }))).toStrictEqual([
      {
        id: 'group-brief-language',
        labelFor: 'group-brief-language',
        name: 'group-brief-language',
      },
    ]);
  });

  it('gives generation modes exact accessible submission metadata', () => {
    renderGroupBriefForm();

    const modes = within(screen.getByRole('group', { name: 'Generation mode' }))
      .getAllByRole<HTMLInputElement>('radio');

    expect(modes.map((mode) => ({
      id: mode.id,
      labelFor: mode.labels?.[0]?.htmlFor,
      name: mode.name,
      value: mode.value,
    }))).toStrictEqual([
      {
        id: 'group-brief-mode-improve_current_url',
        labelFor: 'group-brief-mode-improve_current_url',
        name: 'group-brief-mode',
        value: 'improve_current_url',
      },
      {
        id: 'group-brief-mode-rewrite_pasted_copy',
        labelFor: 'group-brief-mode-rewrite_pasted_copy',
        name: 'group-brief-mode',
        value: 'rewrite_pasted_copy',
      },
      {
        id: 'group-brief-mode-create_new_landing_page',
        labelFor: 'group-brief-mode-create_new_landing_page',
        name: 'group-brief-mode',
        value: 'create_new_landing_page',
      },
    ]);
  });

  it('gives keyword checkboxes unique ids with one plural name', () => {
    renderGroupBriefForm();

    const checkboxes = ['Alpha keyword', 'Beta keyword', 'Other group keyword'].map((name) => (
      screen.getByRole<HTMLInputElement>('checkbox', { name })
    ));

    expect(checkboxes.map((checkbox) => ({
      id: checkbox.id,
      labelFor: checkbox.labels?.[0]?.htmlFor,
      name: checkbox.name,
      value: checkbox.value,
    }))).toStrictEqual([
      {
        id: 'group-brief-keyword-scope-section-group-1-keyword-keyword-1',
        labelFor: 'group-brief-keyword-scope-section-group-1-keyword-keyword-1',
        name: 'group-brief-keyword-ids',
        value: 'keyword-1',
      },
      {
        id: 'group-brief-keyword-scope-section-group-1-keyword-keyword-2',
        labelFor: 'group-brief-keyword-scope-section-group-1-keyword-keyword-2',
        name: 'group-brief-keyword-ids',
        value: 'keyword-2',
      },
      {
        id: 'group-brief-keyword-scope-section-group-2-keyword-keyword-other',
        labelFor: 'group-brief-keyword-scope-section-group-2-keyword-keyword-other',
        name: 'group-brief-keyword-ids',
        value: 'keyword-other',
      },
    ]);
  });

  it('associates the URL field with its group-brief identity', async () => {
    renderGroupBriefForm();

    await userEvent.click(screen.getByRole('radio', { name: /Improve current URL/u }));
    const landingUrl = screen.getByLabelText<HTMLInputElement>('Current landing URL');

    expect({
      id: landingUrl.id,
      labelFor: landingUrl.labels?.[0]?.htmlFor,
      name: landingUrl.name,
    }).toStrictEqual({
      id: 'group-brief-url',
      labelFor: 'group-brief-url',
      name: 'group-brief-url',
    });
  });

  it('associates the copy field with its group-brief identity', async () => {
    renderGroupBriefForm();

    await userEvent.click(screen.getByRole('radio', { name: /Rewrite pasted copy/u }));
    const currentCopy = screen.getByLabelText<HTMLTextAreaElement>('Current copy');

    expect({
      id: currentCopy.id,
      labelFor: currentCopy.labels?.[0]?.htmlFor,
      name: currentCopy.name,
    }).toStrictEqual({
      id: 'group-brief-copy',
      labelFor: 'group-brief-copy',
      name: 'group-brief-copy',
    });
  });

  it('disables request controls while a request is starting', () => {
    renderGroupBriefForm({ generating: true });

    expect(screen.getByRole('button', { name: 'Review generation' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Groups' })).toBeDisabled();
    expect(screen.getByLabelText('Prompt template')).toBeDisabled();
  });
});
