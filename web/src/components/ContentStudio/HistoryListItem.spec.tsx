import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { HistoryListItem } from './HistoryListItem';
import {
  buildContentStudioHistory,
  createHistoryListItemProps,
  incompleteMetadataWarning,
  whitespaceGeneratedTitleOverrides,
} from './ContentStudioHistory-fixtures';

function renderHistoryListItem(
  overrides: Parameters<typeof buildContentStudioHistory>[0]
): void {
  const item = buildContentStudioHistory(overrides);
  render(<HistoryListItem {...createHistoryListItemProps(item)} />);
}

describe('HistoryListItem', () => {
  it('renders trimmed generated title when generated title is nonblank', () => {
    renderHistoryListItem({ generated_content: { title: '  Generated title with spacing  ' } });

    expect(screen.getByRole('heading', { name: 'Generated title with spacing' })).toBeInTheDocument();
  });

  it('renders trimmed idea title when generated title contains only whitespace', () => {
    renderHistoryListItem(whitespaceGeneratedTitleOverrides);

    expect(screen.getByText('Useful idea title')).toBeInTheDocument();
  });

  it('renders keyword when generated and idea titles are blank', () => {
    renderHistoryListItem({
      keyword: '  fallback keyword  ',
      idea_title: ' ',
      generated_content: { title: '' },
    });

    expect(screen.getByRole('heading', { name: 'fallback keyword' })).toBeInTheDocument();
  });

  it('shows incomplete-metadata warning when warning is propagated', () => {
    renderHistoryListItem({ content_warning: incompleteMetadataWarning });

    expect(screen.getByRole('status')).toHaveTextContent(incompleteMetadataWarning.message);
  });

  it('keeps generated description visible when incomplete-metadata warning is propagated', () => {
    renderHistoryListItem({
      content_warning: incompleteMetadataWarning,
      generated_content: { meta_description: 'Useful generated description' },
    });

    expect(screen.getByText('Useful generated description')).toBeInTheDocument();
  });
});
