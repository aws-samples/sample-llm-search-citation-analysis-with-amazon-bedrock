import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { ContentHistory } from './ContentHistory';
import { buildContentStudioHistory } from './ContentStudioHistory-fixtures';
import { itPagesWithLoadMoreButton } from '../ui/LoadMoreButton-fixtures';

describe('ContentHistory', () => {
  itPagesWithLoadMoreButton('Load older content', (props) => render(
    <ContentHistory history={[buildContentStudioHistory()]} loading={false} onDelete={vi.fn()} onMarkViewed={vi.fn()} {...props} />
  ));

  it('shows the empty state instead of a load button when there is no history yet', () => {
    render(<ContentHistory history={[]} loading={false} onDelete={vi.fn()} onMarkViewed={vi.fn()} onLoadMore={vi.fn()} />);

    expect(screen.getByText('No generated content yet.')).toBeInTheDocument();
  });
});
