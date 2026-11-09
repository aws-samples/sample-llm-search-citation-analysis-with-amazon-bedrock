import {
  describe, expect, it
} from 'vitest';
import userEvent from '@testing-library/user-event';
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
) {
  const item = buildContentStudioHistory(overrides);
  const props = createHistoryListItemProps(item);
  render(<HistoryListItem {...props} />);
  return {
    item,
    props 
  };
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

  it('opens the item from a keyboard-reachable title button', async () => {
    const {
      item, props
    } = renderHistoryListItem({ generated_content: { title: 'Keyboard title' } });

    screen.getByRole('button', { name: 'Keyboard title' }).focus();
    await userEvent.keyboard('{Enter}');

    expect(props.onSelect).toHaveBeenCalledWith(item);
  });

  it('names the icon-only delete button', () => {
    renderHistoryListItem({});

    expect(screen.getByRole('button', { name: 'Delete content' })).toBeInTheDocument();
  });
});
