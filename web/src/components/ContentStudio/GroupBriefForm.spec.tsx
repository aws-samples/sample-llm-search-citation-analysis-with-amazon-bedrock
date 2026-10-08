import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, screen, waitFor, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  buildApiBatchRequest,
  buildApiGroupBriefIdea,
} from '../../api/contentStudio-fixtures';
import { useContentBriefTemplates } from '../../hooks/useContentBriefTemplates';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import * as groupBriefSource from './GroupBriefForm-source';
import {
  GROUP_BRIEF_BATCH_LIMIT_GUIDANCE,
  GROUP_BRIEF_DEFAULT_TEMPLATES,
} from './GroupBriefForm-source';
import {
  buildContentBriefGroupScope,
  buildContentBriefKeywordScope,
  buildContentBriefTemplate,
  buildContentBriefTemplatesHookResult,
  buildContentBriefTemplatesHookResultWithSaved,
  buildKeyword,
  buildKeywordGroupHookResult,
  buildNumberedKeywords,
  buildSavedContentBriefTemplate,
  chooseGroupBriefMode,
  confirmGroupBrief,
  fillImproveUrlBrief,
  renderGroupBriefForm,
  reviewGroupBrief,
  selectAllKeywordsForBrief,
  selectGroupBriefMode,
  selectGroupForBrief,
  selectKeywordsForBrief,
  selectPerKeywordBatch,
  selectPerKeywordStrategy,
  readFieldIdentity,
  submitGroupBrief,
  submitKeywordBrief,
} from './GroupBriefForm-fixtures';

vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));
vi.mock('../../hooks/useContentBriefTemplates', () => ({ useContentBriefTemplates: vi.fn() }));

const mockUseKeywordGroups = vi.mocked(useKeywordGroups);
const mockUseContentBriefTemplates = vi.mocked(useContentBriefTemplates);

const THREE_KEYWORD_NAMES = ['Alpha keyword', 'Beta keyword', 'Other group keyword'];

const modeFieldIdentityCases = [
  {
    testName: 'associates the URL field with its group-brief identity',
    mode: /Improve current URL/u,
    label: 'Current landing URL',
    identity: 'group-brief-url',
  },
  {
    testName: 'associates the copy field with its group-brief identity',
    mode: /Rewrite pasted copy/u,
    label: 'Current copy',
    identity: 'group-brief-copy',
  },
];

beforeEach(() => {
  mockUseKeywordGroups.mockReturnValue(buildKeywordGroupHookResult());
  mockUseContentBriefTemplates.mockReturnValue(buildContentBriefTemplatesHookResult());
  vi.spyOn(groupBriefSource, 'createGroupBriefIdeaId')
    .mockReturnValueOnce('brief-stable-id')
    .mockReturnValue('brief-next-id');
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

    expect(formProps.onGenerate).toHaveBeenCalledWith(buildApiGroupBriefIdea({
      id: 'brief-stable-id',
      scope: buildContentBriefGroupScope(['group-1']),
    }));
  });

  it('sends arbitrary active keyword IDs without requiring a group', async () => {
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupHookResult({ groups: [] }));
    const formProps = renderGroupBriefForm();

    await submitKeywordBrief(['Alpha keyword', 'Other group keyword']);

    expect(formProps.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ scope: buildContentBriefKeywordScope(['keyword-1', 'keyword-other']) }));
    expect(formProps.onGenerateBatch).not.toHaveBeenCalledWith(expect.anything());
  });

  it('treats one selected keyword as an ordinary combined brief', async () => {
    const formProps = renderGroupBriefForm();

    await submitKeywordBrief(['Alpha keyword']);

    expect(formProps.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ scope: buildContentBriefKeywordScope(['keyword-1']) }));
    expect(screen.queryByText(/keyword group is required/iu)).not.toBeInTheDocument();
  });

  it('preserves all 50 selected keyword IDs in a combined request', async () => {
    const keywords = buildNumberedKeywords(50);
    const formProps = renderGroupBriefForm({ keywords });
    await selectAllKeywordsForBrief();

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
    await selectPerKeywordBatch(THREE_KEYWORD_NAMES);

    await reviewGroupBrief();
    await confirmGroupBrief(3);

    expect(formProps.onGenerateBatch).toHaveBeenCalledWith(buildApiBatchRequest({
      batch_id: 'brief-stable-id',
      scope: buildContentBriefKeywordScope([
        'keyword-1', 'keyword-2', 'keyword-other'
      ]),
    }));
    expect(formProps.onGenerate).not.toHaveBeenCalledWith(expect.anything());
  });

  it('shows the exact paid-call count before a three-keyword batch starts', async () => {
    const formProps = renderGroupBriefForm();
    await selectPerKeywordBatch(THREE_KEYWORD_NAMES);

    expect(screen.getByText('Estimated paid model calls: 3')).toBeInTheDocument();
    await reviewGroupBrief();

    expect(screen.getByText(
      'This will start 3 background jobs and make 3 paid model calls.'
    )).toBeInTheDocument();
    expect(formProps.onGenerateBatch).not.toHaveBeenCalledWith(expect.anything());
  });

  it('blocks a per-keyword batch above ten with actionable guidance', async () => {
    renderGroupBriefForm({ keywords: buildNumberedKeywords(11) });
    await selectAllKeywordsForBrief();
    await selectPerKeywordStrategy();

    expect(screen.getByText(GROUP_BRIEF_BATCH_LIMIT_GUIDANCE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review generation' })).toBeDisabled();
    expect(screen.getByText('Estimated paid model calls: 11')).toBeInTheDocument();
  });

  it('explains equivalence when one keyword uses the per-keyword strategy', async () => {
    renderGroupBriefForm();
    await selectPerKeywordBatch(['Alpha keyword']);

    expect(screen.getByText(/combined option is equivalent/iu)).toBeInTheDocument();
    expect(screen.getByText('Estimated paid model calls: 1')).toBeInTheDocument();
  });
});

describe('GroupBriefForm content fields', () => {
  it('requires an http or https URL when improve current URL mode is selected', async () => {
    renderGroupBriefForm();
    await selectGroupBriefMode(/Improve current URL/u);

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
    await selectGroupBriefMode(/Rewrite pasted copy/u);
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
    const saved = buildSavedContentBriefTemplate({
      created_by: 'user-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    mockUseContentBriefTemplates.mockReturnValue(
      buildContentBriefTemplatesHookResultWithSaved(saved)
    );
    renderGroupBriefForm();

    await userEvent.selectOptions(screen.getByLabelText('Saved template'), saved.id);

    expect(screen.getByRole('button', { name: 'Update template' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete template' })).toBeEnabled();
  });

  it('uses the exact server snapshot returned by a later template update', async () => {
    const saved = buildSavedContentBriefTemplate({ prompt_template: 'Original {scope}' });
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
    mockUseContentBriefTemplates.mockReturnValue(
      buildContentBriefTemplatesHookResultWithSaved(saved, { update })
    );
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

    await submitKeywordBrief(['Alpha keyword']);

    expect(formProps.onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      template_id: 'saved-template',
      prompt_template: 'Authoritative updated {scope}',
    }));
  });

  it('deletes a saved template only after confirmation', async () => {
    const saved = buildSavedContentBriefTemplate();
    const remove = vi.fn().mockResolvedValue({
      success: true,
      message: 'Template deleted',
    });
    mockUseContentBriefTemplates.mockReturnValue(
      buildContentBriefTemplatesHookResultWithSaved(saved, { remove })
    );
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

    expect(screen.getByText('Loading keyword groups')).toBeInTheDocument();
  });

  it('associates always-visible fields with group-brief identities', () => {
    renderGroupBriefForm();

    const fields = ['Output language'].map((label) => (
      screen.getByLabelText<HTMLSelectElement>(label)
    ));

    expect(fields.map(readFieldIdentity)).toStrictEqual([
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
      ...readFieldIdentity(mode),
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

    const checkboxes = THREE_KEYWORD_NAMES.map((name) => (
      screen.getByRole<HTMLInputElement>('checkbox', { name })
    ));

    expect(checkboxes.map((checkbox) => ({
      ...readFieldIdentity(checkbox),
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

  it.each(modeFieldIdentityCases)('$testName', async ({
    mode, label, identity
  }) => {
    renderGroupBriefForm();

    await chooseGroupBriefMode(mode);
    const field = screen.getByLabelText<HTMLInputElement | HTMLTextAreaElement>(label);

    expect(readFieldIdentity(field)).toStrictEqual({
      id: identity,
      labelFor: identity,
      name: identity,
    });
  });

  it('disables request controls while a request is starting', () => {
    renderGroupBriefForm({ generating: true });

    expect(screen.getByRole('button', { name: 'Review generation' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Groups' })).toBeDisabled();
    expect(screen.getByLabelText('Prompt template')).toBeDisabled();
  });
});
