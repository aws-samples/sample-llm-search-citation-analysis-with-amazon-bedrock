import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import * as groupBriefSource from './GroupBriefForm-source';
import { GROUP_BRIEF_DEFAULT_TEMPLATES } from './GroupBriefForm-source';
import {
  buildKeyword,
  buildKeywordGroupHookResult,
  fillImproveUrlBrief,
  renderGroupBriefForm,
  selectGroupForBrief,
  submitGroupBrief,
} from './GroupBriefForm-fixtures';

vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));

const mockUseKeywordGroups = vi.mocked(useKeywordGroups);

describe('GroupBriefForm', () => {
  beforeEach(() => {
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupHookResult());
    vi.spyOn(groupBriefSource, 'createGroupBriefIdeaId')
      .mockReturnValueOnce('brief-stable-id')
      .mockReturnValue('brief-next-id');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state when keyword groups are loading', () => {
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupHookResult({ loading: true }));

    renderGroupBriefForm();

    expect(screen.getByText('Loading keyword groups...')).toBeInTheDocument();
  });

  it('shows useful empty state when no keyword groups exist', () => {
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupHookResult({ groups: [] }));

    renderGroupBriefForm();

    expect(screen.getByText('No keyword groups yet')).toBeInTheDocument();
  });

  it('associates always-visible fields with group-brief identities', () => {
    renderGroupBriefForm();

    const fields = ['Keyword group', 'Output language'].map((label) => (
      screen.getByLabelText<HTMLSelectElement>(label)
    ));

    expect(fields.map((field) => ({
      id: field.id,
      labelFor: field.labels?.[0]?.htmlFor,
      name: field.name,
    }))).toStrictEqual([
      {
        id: 'group-brief-group',
        labelFor: 'group-brief-group',
        name: 'group-brief-group',
      },
      {
        id: 'group-brief-language',
        labelFor: 'group-brief-language',
        name: 'group-brief-language',
      },
    ]);
  });

  it('gives generation modes exact accessible submission metadata', () => {
    renderGroupBriefForm();

    const modes = screen.getAllByRole<HTMLInputElement>('radio');

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

  it('gives keyword checkboxes unique ids with one plural name', async () => {
    renderGroupBriefForm();

    await selectGroupForBrief();

    const checkboxes = screen.getAllByRole<HTMLInputElement>('checkbox');

    expect(checkboxes.map((checkbox) => ({
      id: checkbox.id,
      labelFor: checkbox.labels?.[0]?.htmlFor,
      name: checkbox.name,
      value: checkbox.value,
    }))).toStrictEqual([
      {
        id: 'group-brief-keyword-keyword-1',
        labelFor: 'group-brief-keyword-keyword-1',
        name: 'group-brief-keyword-ids',
        value: 'keyword-1',
      },
      {
        id: 'group-brief-keyword-keyword-2',
        labelFor: 'group-brief-keyword-keyword-2',
        name: 'group-brief-keyword-ids',
        value: 'keyword-2',
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

  it('selects every active member when a group is selected', async () => {
    renderGroupBriefForm();

    await selectGroupForBrief();

    expect(screen.getByRole('checkbox', { name: /Alpha keyword/u })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Beta keyword/u })).toBeChecked();
    expect(screen.queryByText('Inactive keyword')).not.toBeInTheDocument();
    expect(screen.getAllByText('Active')).toHaveLength(2);
  });

  it('requires an http or https URL when improve current URL mode is selected', async () => {
    renderGroupBriefForm();

    await selectGroupForBrief();
    await userEvent.click(screen.getByRole('radio', { name: /Improve current URL/u }));
    await submitGroupBrief();

    expect(screen.getByText('Enter a valid http or https landing URL.')).toBeInTheDocument();
  });

  it('requires non-whitespace copy when rewrite pasted copy mode is selected', async () => {
    renderGroupBriefForm();

    await selectGroupForBrief();
    await userEvent.click(screen.getByRole('radio', { name: /Rewrite pasted copy/u }));
    await userEvent.type(screen.getByLabelText('Current copy'), '   ');
    await submitGroupBrief();

    expect(screen.getByText('Enter the current copy to rewrite.')).toBeInTheDocument();
  });

  it('submits exact complete idea when create-new mode has no source content', async () => {
    const formProps = renderGroupBriefForm();

    await selectGroupForBrief();
    await userEvent.click(screen.getByRole('checkbox', { name: /Beta keyword/u }));
    fireEvent.change(screen.getByLabelText('Prompt template'), { target: { value: 'Custom {brand} for {keywords} in {output_language}' } });
    await userEvent.selectOptions(screen.getByLabelText('Output language'), 'Spanish');
    await submitGroupBrief();

    await waitFor(() => {
      expect(formProps.onGenerate).toHaveBeenCalledWith({
        id: 'brief-stable-id',
        type: 'group_brief',
        priority: 'medium',
        title: 'Group Brief: Generic Group',
        description: 'Generate a complete landing page from 1 selected active keyword.',
        keyword: 'Generic Group',
        source: 'group_brief',
        actionable: true,
        content_angle: 'create_new_landing_page',
        group_id: 'group-1',
        group_name: 'Generic Group',
        keyword_ids: ['keyword-1'],
        keywords: ['Alpha keyword'],
        landing_url: '',
        current_copy: '',
        prompt_template: 'Custom {brand} for {keywords} in {output_language}',
        output_language: 'Spanish',
        competitor_urls: [],
      });
    });
  });

  it('submits landing URL when improve current URL mode is valid', async () => {
    const formProps = renderGroupBriefForm();

    await fillImproveUrlBrief('https://example.com/page');
    await submitGroupBrief();

    await waitFor(() => {
      expect(formProps.onGenerate).toHaveBeenCalledWith(expect.objectContaining({
        content_angle: 'improve_current_url',
        landing_url: 'https://example.com/page',
        current_copy: '',
      }));
    });
  });

  it('submits pasted copy when rewrite pasted copy mode is valid', async () => {
    const formProps = renderGroupBriefForm();

    await selectGroupForBrief();
    await userEvent.click(screen.getByRole('radio', { name: /Rewrite pasted copy/u }));
    await userEvent.type(screen.getByLabelText('Current copy'), 'Existing landing page copy.');
    await submitGroupBrief();

    await waitFor(() => {
      expect(formProps.onGenerate).toHaveBeenCalledWith(expect.objectContaining({
        content_angle: 'rewrite_pasted_copy',
        landing_url: '',
        current_copy: 'Existing landing page copy.',
      }));
    });
  });

  it('restores the current mode default when prompt template is reset', async () => {
    renderGroupBriefForm();

    await userEvent.click(screen.getByRole('radio', { name: /Rewrite pasted copy/u }));
    fireEvent.change(screen.getByLabelText('Prompt template'), { target: { value: 'Custom {brand}' } });
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));

    expect(screen.getByLabelText('Prompt template')).toHaveValue(
      GROUP_BRIEF_DEFAULT_TEMPLATES.rewrite_pasted_copy
    );
    expect(screen.getByText('5650 characters remaining')).toBeInTheDocument();
  });

  it('rejects unknown prompt placeholders before generation', async () => {
    const formProps = renderGroupBriefForm();

    await selectGroupForBrief();
    fireEvent.change(screen.getByLabelText('Prompt template'), { target: { value: 'Use {industry}' } });
    await submitGroupBrief();

    expect(screen.getByText('Prompt template contains unknown placeholder(s): industry.')).toBeInTheDocument();
    expect(formProps.onGenerate).not.toHaveBeenCalledWith(expect.anything());
  });

  it('rejects a placeholder repeated more than twice before generation', async () => {
    const formProps = renderGroupBriefForm();

    await selectGroupForBrief();
    fireEvent.change(screen.getByLabelText('Prompt template'), { target: { value: '{current_copy}{current_copy}{current_copy}' } });
    await submitGroupBrief();

    expect(screen.getByText(
      'Prompt template repeats placeholder(s) too many times: current_copy.'
    )).toBeInTheDocument();
    expect(formProps.onGenerate).not.toHaveBeenCalledWith(expect.anything());
  });

  it('clears hidden URL data when switching to create-new mode', async () => {
    const formProps = renderGroupBriefForm();

    await fillImproveUrlBrief('not-a-url');
    await userEvent.click(screen.getByRole('radio', { name: /Create new landing page/u }));
    await submitGroupBrief();

    await waitFor(() => {
      expect(formProps.onGenerate).toHaveBeenCalledWith(expect.objectContaining({
        content_angle: 'create_new_landing_page',
        landing_url: '',
        current_copy: '',
      }));
    });
  });

  it('excludes group members without an active status', async () => {
    renderGroupBriefForm({ keywords: [buildKeyword({ status: undefined })] });

    await selectGroupForBrief();

    expect(screen.queryByText('Alpha keyword')).not.toBeInTheDocument();
    expect(screen.getByText(/This group has no active keywords/u)).toBeInTheDocument();
  });

  it('disables generation controls while a request is starting', () => {
    renderGroupBriefForm({ generating: true });

    expect(screen.getByRole('button', { name: 'Starting generation...' })).toBeDisabled();
    expect(screen.getByLabelText('Keyword group')).toBeDisabled();
  });
});
