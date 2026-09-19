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
