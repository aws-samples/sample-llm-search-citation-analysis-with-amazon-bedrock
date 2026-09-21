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
  incompleteMetadataWarning
} from './ContentStudioHistory-fixtures';

describe('HistoryListItem', () => {
  it('renders trimmed generated title when generated title is nonblank', () => {
    const item = buildContentStudioHistory({ generated_content: { title: '  Generated title with spacing  ' } });

    render(<HistoryListItem {...createHistoryListItemProps(item)} />);

    expect(screen.getByRole('heading', { name: 'Generated title with spacing' })).toBeInTheDocument();
  });

  it('renders trimmed idea title when generated title contains only whitespace', () => {
    const item = buildContentStudioHistory({
      idea_title: '  Useful idea title  ',
      generated_content: { title: '   ' },
    });

    render(<HistoryListItem {...createHistoryListItemProps(item)} />);

    expect(screen.getByText('Useful idea title')).toBeInTheDocument();
  });

  it('renders keyword when generated and idea titles are blank', () => {
    const item = buildContentStudioHistory({
      keyword: '  fallback keyword  ',
      idea_title: ' ',
      generated_content: { title: '' },
    });

    render(<HistoryListItem {...createHistoryListItemProps(item)} />);

    expect(screen.getByRole('heading', { name: 'fallback keyword' })).toBeInTheDocument();
  });

  it('shows incomplete-metadata warning when warning is propagated', () => {
    const item = buildContentStudioHistory({ content_warning: incompleteMetadataWarning });

    render(<HistoryListItem {...createHistoryListItemProps(item)} />);

    expect(screen.getByRole('status')).toHaveTextContent(incompleteMetadataWarning.message);
  });

  it('keeps generated description visible when incomplete-metadata warning is propagated', () => {
    const item = buildContentStudioHistory({
      content_warning: incompleteMetadataWarning,
      generated_content: { meta_description: 'Useful generated description' },
    });

    render(<HistoryListItem {...createHistoryListItemProps(item)} />);

    expect(screen.getByText('Useful generated description')).toBeInTheDocument();
  });
});
