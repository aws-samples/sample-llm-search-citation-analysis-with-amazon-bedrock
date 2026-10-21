import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContentHistory } from './ContentHistory';
import { buildContentStudioHistory } from './ContentStudioHistory-fixtures';

describe('ContentHistory', () => {
  it('asks for older content when the load button is pressed', async () => {
    const onLoadMore = vi.fn();
    render(
      <ContentHistory
        history={[buildContentStudioHistory()]}
        loading={false}
        onDelete={vi.fn()}
        onMarkViewed={vi.fn()}
        onLoadMore={onLoadMore}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Load older content' }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('disables the load button while older content loads', () => {
    render(
      <ContentHistory
        history={[buildContentStudioHistory()]}
        loading={false}
        onDelete={vi.fn()}
        onMarkViewed={vi.fn()}
        onLoadMore={vi.fn()}
        loadingMore
      />
    );

    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });

  it('shows no load button when the whole history is loaded', () => {
    render(
      <ContentHistory history={[buildContentStudioHistory()]} loading={false} onDelete={vi.fn()} onMarkViewed={vi.fn()} />
    );

    expect(screen.queryByRole('button', { name: 'Load older content' })).not.toBeInTheDocument();
  });
});
