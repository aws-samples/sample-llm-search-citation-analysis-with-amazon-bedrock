import {
  expect, it, vi
} from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';

/** The paging props a list hands to its `LoadMoreButton`. */
interface LoadMoreProps {
  readonly onLoadMore?: () => void;
  readonly loadingMore?: boolean;
}

/**
 * The load-more behaviour every paged list shares: the button labelled
 * `label` asks for the next page, is disabled while that page loads, and is
 * absent once everything is loaded. `renderList` renders the list under test
 * with the given paging props.
 */
export function itPagesWithLoadMoreButton(label: string, renderList: (props: LoadMoreProps) => unknown) {
  it(`asks for the next page when "${label}" is pressed`, () => {
    const onLoadMore = vi.fn();
    renderList({ onLoadMore });

    fireEvent.click(screen.getByRole('button', { name: label }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('disables the load button while the next page loads', () => {
    renderList({
      onLoadMore: vi.fn(),
      loadingMore: true,
    });

    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });

  it('shows no load button when everything is loaded', () => {
    renderList({});

    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
  });
}
