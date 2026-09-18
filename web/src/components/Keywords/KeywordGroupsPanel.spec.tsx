import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordGroupsPanel } from './KeywordGroupsPanel';
import type { GroupFilter } from './KeywordGroupsPanel';
import { buildGroup } from '../../api/keywordGroups-fixtures';

const groups = [
  buildGroup({
    id: 'coruna',
    name: 'Hotel Coruña',
    keyword_count: 3 
  }),
  buildGroup({
    id: 'marino',
    name: 'Hotel Gran Marino',
    keyword_count: 0 
  }),
];

function renderPanel(overrides: Partial<Parameters<typeof KeywordGroupsPanel>[0]> = {}) {
  const props = {
    groups,
    loading: false,
    totalKeywords: 5,
    ungroupedCount: 2,
    filter: 'all' as GroupFilter,
    onFilterChange: vi.fn(),
    onCreate: vi.fn(() => Promise.resolve({
      success: true,
      message: 'ok' 
    })),
    onRename: vi.fn(() => Promise.resolve({
      success: true,
      message: 'ok' 
    })),
    onDelete: vi.fn(),
    onNotify: vi.fn(),
    ...overrides,
  };
  render(<KeywordGroupsPanel {...props} />);
  return props;
}

describe('KeywordGroupsPanel', () => {
  it('shows every group with its keyword count', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Hotel Coruña (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hotel Gran Marino (0)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All (5)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ungrouped (2)' })).toBeInTheDocument();
  });

  it('creates a group from the trimmed input and clears the field on success', async () => {
    const props = renderPanel();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'New group name' });

    await user.type(input, '  Hotel Playa  ');
    await user.click(screen.getByRole('button', { name: 'Create group' }));

    expect(props.onCreate).toHaveBeenCalledWith('Hotel Playa');
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('surfaces a failed creation through onNotify and keeps the typed name', async () => {
    const props = renderPanel({
      onCreate: vi.fn(() => Promise.resolve({
        success: false,
        message: 'A keyword group with this name already exists' 
      })),
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
    const props = renderPanel();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Hotel Coruña (3)' }));

    expect(props.onFilterChange).toHaveBeenCalledWith({ groupId: 'coruna' });
  });

  it('renames a group inline', async () => {
    const props = renderPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rename group Hotel Coruña' }));
    const input = screen.getByRole('textbox', { name: 'Rename group Hotel Coruña' });
    await user.clear(input);
    await user.type(input, 'Hotel A Coruña{Enter}');

    expect(props.onRename).toHaveBeenCalledWith('coruna', 'Hotel A Coruña');
  });

  it('asks the parent to delete the group with the full group record', async () => {
    const props = renderPanel();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete group Hotel Gran Marino' }));

    expect(props.onDelete).toHaveBeenCalledWith(groups[1]);
  });
});
