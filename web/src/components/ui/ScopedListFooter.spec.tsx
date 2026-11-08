import {
  describe, expect, it, vi
} from 'vitest';
import { ScopedListFooter } from './ScopedListFooter';
import {
  render, screen
} from '@testing-library/react';
import type { ScopedList } from '../../hooks/useScopedList';
import { clickLoadMore } from '../../test/scopedTestKit';

const loadedList: ScopedList<unknown> = {
  items: [1, 2],
  total: 5000,
  loadMore: undefined,
  loadingMore: false,
  error: null,
  restarted: false,
};

/** Renders the footer of `loadedList` with `overrides`, for a list of keywords unless `noun` says otherwise. */
function renderFooter(overrides: Partial<ScopedList<unknown>>, noun = 'keywords', autoLoad = false) {
  return render(<ScopedListFooter list={{
    ...loadedList,
    ...overrides,
  }} noun={noun} autoLoad={autoLoad} />);
}

describe('ScopedListFooter', () => {
  it('says how many of the total rows are shown', () => {
    renderFooter({});

    expect(screen.getByText('Showing 2 of 5,000 keywords')).toBeInTheDocument();
  });

  it('loads the next page when the button is pressed', async () => {
    const loadMore = vi.fn(() => Promise.resolve());
    renderFooter({ loadMore });

    await clickLoadMore('keywords');

    expect(loadMore).toHaveBeenCalledWith();
  });

  it('says the list started over when its cursor expired', () => {
    renderFooter({ restarted: true });

    expect(screen.getByRole('note')).toHaveTextContent('it was loaded again from the start');
  });

  it('announces a page error', () => {
    renderFooter({ error: 'Server error occurred' });

    expect(screen.getByRole('alert')).toHaveTextContent('Server error occurred');
  });

  it('loads the next page when an infinite list scrolls its footer into view', () => {
    const observed: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        observed.push(callback);
      }

      observe = vi.fn();

      disconnect = vi.fn();
    });
    const loadMore = vi.fn(() => Promise.resolve());
    renderFooter({ loadMore }, 'recommendations', true);

    observed[0]?.([{ isIntersecting: true }]);
    vi.unstubAllGlobals();

    expect(loadMore).toHaveBeenCalledWith();
  });

  it('renders nothing when every row is loaded and nothing went wrong', () => {
    const { container } = renderFooter({ total: 2 });

    expect(container).toBeEmptyDOMElement();
  });
});
