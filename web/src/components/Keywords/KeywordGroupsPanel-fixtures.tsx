import type { ComponentProps } from 'react';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { buildGroup } from '../../api/keywordGroups-fixtures';
import { KeywordGroupsPanel } from './KeywordGroupsPanel';
import { chooseMenuAction } from './KeywordsManager-fixtures';

export const KEYWORD_GROUPS = [
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

const SUCCESS_RESULT = {
  success: true,
  message: 'ok'
};

function buildKeywordGroupsPanelProps(
  overrides: Partial<ComponentProps<typeof KeywordGroupsPanel>> = {}
): ComponentProps<typeof KeywordGroupsPanel> {
  return {
    groups: KEYWORD_GROUPS,
    loading: false,
    totalKeywords: 5,
    ungroupedCount: 2,
    filter: 'all',
    onFilterChange: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(SUCCESS_RESULT),
    onRename: vi.fn().mockResolvedValue(SUCCESS_RESULT),
    onDelete: vi.fn(),
    onNotify: vi.fn(),
    ...overrides,
  };
}

export function renderKeywordGroupsPanel(
  overrides: Partial<ComponentProps<typeof KeywordGroupsPanel>> = {}
) {
  const props = buildKeywordGroupsPanelProps(overrides);
  render(<KeywordGroupsPanel {...props} />);
  return props;
}

/** Opens the ⋯ of `groupName` and picks `action` (Rename or Delete). */
export async function chooseGroupAction(groupName: string, action: 'Rename' | 'Delete'): Promise<void> {
  await chooseMenuAction(`Actions for group ${groupName}`, action);
}

/** The new-group name field, or null while it is closed. */
export function queryNewGroupField(): HTMLElement | null {
  return screen.queryByRole('textbox', { name: 'New group name' });
}

/** Presses "New group" and returns the name field it opens. */
export async function openNewGroupForm(): Promise<HTMLElement> {
  await userEvent.setup().click(screen.getByRole('button', { name: 'New group' }));
  return screen.getByRole('textbox', { name: 'New group name' });
}
