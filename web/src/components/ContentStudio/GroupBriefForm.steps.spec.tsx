import {
  describe, expect, it, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { setupGroupBriefHookMocks } from './GroupBriefForm-client-id-fixtures';
import {
  GROUP_SCOPE_RADIO,
  buildKeywordGroup,
  buildKeywordGroupHookResult,
  chooseGroupBriefMode,
  renderGroupBriefForm,
  reviewGroupBrief,
  selectGroupForBrief,
} from './GroupBriefForm-fixtures';

vi.mock('../../hooks/useKeywordGroups');
vi.mock('../../hooks/useContentBriefTemplates');

describe('GroupBriefForm steps', () => {
  setupGroupBriefHookMocks();

  it('asks what, which keywords, then review, in that order', () => {
    renderGroupBriefForm();

    const steps = screen.getAllByRole('group', { name: /^Step \d:/u });

    expect(steps).toStrictEqual([
      screen.getByRole('group', { name: 'Step 1: What do you want to write?' }),
      screen.getByRole('group', { name: 'Step 2: Which keywords?' }),
      screen.getByRole('group', { name: 'Step 3: Review and start' }),
    ]);
  });

  it('preselects a new landing page and keeps the prompt editor closed', () => {
    renderGroupBriefForm();

    expect(screen.getByRole('radio', { name: /^Create a new landing page/u })).toBeChecked();
    expect(screen.getByRole('button', { name: /^Customize the prompt/u })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Prompt template' })).not.toBeInTheDocument();
  });

  it('opens and closes the prompt editor from its toggle', async () => {
    renderGroupBriefForm();
    const toggle = screen.getByRole('button', { name: /^Customize the prompt/u });

    await userEvent.click(toggle);
    expect(screen.getByRole('textbox', { name: 'Prompt template' })).toBeVisible();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts on the handed-in keywords with them ticked', () => {
    renderGroupBriefForm({ initialKeywordIds: ['keyword-1'] });

    expect(screen.getByRole('radio', { name: /^Specific keywords/u })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Alpha keyword' })).toBeChecked();
    expect(screen.getByText('1 keyword selected')).toBeInTheDocument();
  });

  it('starts on specific keywords when there are no keyword groups', async () => {
    vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupHookResult({ groups: [] }));
    renderGroupBriefForm();

    expect(screen.getByRole('radio', { name: /^Specific keywords/u })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: GROUP_SCOPE_RADIO }));
    expect(screen.getByText(/No keyword groups yet/u)).toBeInTheDocument();
  });

  it('lists each group with its keyword count and disables empty groups', () => {
    vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupHookResult({
      groups: [buildKeywordGroup(), buildKeywordGroup({
        id: 'group-empty',
        name: 'Empty Group',
        keyword_count: 0,
      })],
    }));
    renderGroupBriefForm();

    const options = within(screen.getByLabelText('Keyword group')).getAllByRole<HTMLOptionElement>('option');
    expect(options.map((option) => [option.textContent, option.disabled])).toStrictEqual([
      ['Choose a group…', false],
      ['Generic Group (3 keywords)', false],
      ['Empty Group (no active keywords)', true],
    ]);
  });

  it('takes the user to the group choice when review finds none', async () => {
    renderGroupBriefForm();

    await reviewGroupBrief();

    expect(screen.getByRole('alert')).toHaveTextContent('Select one keyword group.');
    expect(screen.getByLabelText('Keyword group')).toHaveFocus();
  });

  it('takes the user to the page URL when review finds it missing', async () => {
    renderGroupBriefForm();
    await selectGroupForBrief();
    await chooseGroupBriefMode(/^Improve an existing page/u);

    await reviewGroupBrief();

    expect(screen.getByLabelText('Current landing URL')).toHaveFocus();
  });

  it('names what will be written in the review panel and the cost confirmation', async () => {
    renderGroupBriefForm();
    await selectGroupForBrief();
    const summary = 'Create a new landing page · 2 active keywords in Generic Group · English';

    expect(screen.getByText(summary)).toBeInTheDocument();
    await reviewGroupBrief();

    expect(within(screen.getByRole('dialog', { name: 'Confirm Content Brief generation' })).getByText(summary))
      .toBeInTheDocument();
  });
});
