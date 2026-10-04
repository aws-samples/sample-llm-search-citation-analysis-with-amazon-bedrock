import type { ComponentProps } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { buildGroup } from '../../api/keywordGroups-fixtures';
import { KeywordGroupsPanel } from './KeywordGroupsPanel';

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
