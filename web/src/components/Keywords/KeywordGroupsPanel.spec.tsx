import {
  describe, expect, it, vi
} from 'vitest';
import {
  screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  KEYWORD_GROUPS,
  renderKeywordGroupsPanel,
} from './KeywordGroupsPanel-fixtures';

describe('KeywordGroupsPanel', () => {
  it('describes reusable groups with generic examples', () => {
    renderKeywordGroupsPanel();

    expect(screen.getByText(
      'Organise keywords into reusable groups, for example by brand, market, campaign, or location. A keyword can belong to several groups.'
    )).toBeInTheDocument();
  });

  it('shows a generic campaign example in the new-group placeholder', () => {
    renderKeywordGroupsPanel();

    expect(screen.getByRole('textbox', { name: 'New group name' })).toHaveAttribute(
      'placeholder',
      'New group name (e.g. Spring campaign)'
    );
  });

  it('shows every group with its keyword count', () => {
    renderKeywordGroupsPanel();

    expect(screen.getByRole('button', { name: 'Hotel Coruña (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hotel Gran Marino (0)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All (5)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ungrouped (2)' })).toBeInTheDocument();
  });

  it('creates a group from the trimmed input and clears the field on success', async () => {
    const props = renderKeywordGroupsPanel();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'New group name' });

    await user.type(input, '  Hotel Playa  ');
    await user.click(screen.getByRole('button', { name: 'Create group' }));

    expect(props.onCreate).toHaveBeenCalledWith('Hotel Playa');
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('surfaces a failed creation through onNotify and keeps the typed name', async () => {
    const props = renderKeywordGroupsPanel({
      onCreate: vi.fn().mockResolvedValue({
        success: false,
        message: 'A keyword group with this name already exists'
      }),
    });
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'New group name' });

    await user.type(input, 'Hotel Coruña{Enter}');

    await waitFor(() => expect(props.onNotify).toHaveBeenCalledWith(
      'Could not create group',
      'A keyword group with this name already exists',
      'error'
    ));
    expect(input).toHaveValue('Hotel Coruña');
  });

  it('selects a group as the active filter when its chip is clicked', async () => {
    const props = renderKeywordGroupsPanel();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Hotel Coruña (3)' }));

    expect(props.onFilterChange).toHaveBeenCalledWith({ groupId: 'coruna' });
  });

  it('renames a group inline', async () => {
    const props = renderKeywordGroupsPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rename group Hotel Coruña' }));
    const input = screen.getByRole('textbox', { name: 'Rename group Hotel Coruña' });
    await user.clear(input);
    await user.type(input, 'Hotel A Coruña{Enter}');

    expect(props.onRename).toHaveBeenCalledWith('coruna', 'Hotel A Coruña');
  });

  it('asks the parent to delete the group with the full group record', async () => {
    const props = renderKeywordGroupsPanel();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete group Hotel Gran Marino' }));

    expect(props.onDelete).toHaveBeenCalledWith(KEYWORD_GROUPS[1]);
  });
});
