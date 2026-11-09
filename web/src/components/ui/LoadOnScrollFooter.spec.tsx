import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { LoadOnScrollFooter } from './LoadOnScrollFooter';
import {
  installIntersectionObserverMock, scrollSentinelIntoView
} from '../../test/intersectionObserverMock';

/** The footer of a list with more to load; returns the `onLoadMore` spy. */
function renderFooter(overrides: Partial<ComponentProps<typeof LoadOnScrollFooter>> = {}) {
  const onLoadMore = vi.fn();
  render(<LoadOnScrollFooter onLoadMore={onLoadMore} hasMore loading={false} watch={1} doneLabel="All shown." {...overrides} />);
  return onLoadMore;
}

describe('LoadOnScrollFooter', () => {
  it('asks for the next batch when the end of the list scrolls into view', () => {
    installIntersectionObserverMock();
    const onLoadMore = renderFooter();

    scrollSentinelIntoView();

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('stops loading on its own after a failure and offers "Try again"', () => {
    installIntersectionObserverMock();
    const onLoadMore = renderFooter({ failed: true });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(() => scrollSentinelIntoView()).toThrow('No IntersectionObserver is watching');
  });

  it('keeps the "Load more" button working without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onLoadMore = renderFooter();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('says when everything is shown and offers no button', () => {
    renderFooter({
      hasMore: false,
      doneLabel: 'All 30 keywords are shown.' 
    });

    expect([screen.getByText('All 30 keywords are shown.'), screen.queryByRole('button')]).toStrictEqual([expect.anything(), null]);
  });
});
