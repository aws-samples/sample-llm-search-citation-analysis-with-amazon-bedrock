import {
  describe, expect, it, vi
} from 'vitest';
import {
  act, waitFor
} from '@testing-library/react';
import type { CursorPage } from '../api/cursorPages';
import { TestError } from '../test/testError';
import type { NextPageFetcher } from './useContinuedPages';
import {
  FIRST_PAGE, lastPage, pageFetcher, renderAfterLoadMore, renderContinuedPages, renderLoadingTwice, switchToOtherQuery
} from './useContinuedPages-fixtures';

describe('useContinuedPages', () => {
  it('starts with the first page and says whether more remain', () => {
    const { result } = renderContinuedPages(pageFetcher({}));

    expect([result.current.items, result.current.hasMore, result.current.loadingMore]).toStrictEqual([['a', 'b'], true, false]);
  });

  it('appends each later page and stops at the null token', async () => {
    const fetchNext = pageFetcher({
      'page-2': {
        items: ['c'],
        nextToken: 'page-3',
      },
      'page-3': lastPage('d'),
    });
    const { result } = await renderLoadingTwice(fetchNext, (pages) => pages.items.length === 3);

    await waitFor(() => expect(result.current.items).toStrictEqual(['a', 'b', 'c', 'd']));
    expect([result.current.hasMore, fetchNext.mock.calls.map(([token]) => token)]).toStrictEqual([false, ['page-2', 'page-3']]);
  });

  it('asks for a page once while it is in flight', () => {
    const fetchNext = vi.fn<NextPageFetcher<string>>(() => new Promise(vi.fn()));
    const { result } = renderAfterLoadMore(fetchNext);

    act(() => result.current.loadMore());

    expect([fetchNext.mock.calls.length, result.current.loadingMore]).toStrictEqual([1, true]);
  });

  it('drops rows a later page repeats', async () => {
    const { result } = renderAfterLoadMore(pageFetcher({ 'page-2': lastPage('b', 'c') }));

    await waitFor(() => expect(result.current.items).toStrictEqual(['a', 'b', 'c']));
  });

  it('starts again from a new first page', async () => {
    const fetchNext = pageFetcher({ 'page-2': lastPage('c') });
    const rendered = renderAfterLoadMore(fetchNext);
    await waitFor(() => expect(rendered.result.current.hasMore).toBe(false));

    switchToOtherQuery(rendered, fetchNext);

    expect([rendered.result.current.items, rendered.result.current.hasMore]).toStrictEqual([['x'], true]);
  });

  it('ignores a page that arrives after the first page changed', async () => {
    const settle = vi.fn<(page: CursorPage<string>) => void>();
    const fetchNext = vi.fn<NextPageFetcher<string>>(() => new Promise((resolve) => {
      settle.mockImplementation(resolve);
    }));
    const rendered = renderAfterLoadMore(fetchNext);

    switchToOtherQuery(rendered, fetchNext);
    await act(async () => {
      settle(lastPage('stale'));
      await Promise.resolve();
    });

    expect([rendered.result.current.items, rendered.result.current.loadingMore]).toStrictEqual([['x'], false]);
  });

  it('reports a failed page and loads it when asked again', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const fetchNext = vi.fn<NextPageFetcher<string>>()
      .mockRejectedValueOnce(new TestError('HTTP 500'))
      .mockResolvedValueOnce(lastPage('c'));
    const { result } = await renderLoadingTwice(fetchNext, (pages) => pages.failed);

    await waitFor(() => expect([result.current.items, result.current.failed]).toStrictEqual([['a', 'b', 'c'], false]));
  });

  it('loads nothing while paused or without a first page', () => {
    const fetchNext = pageFetcher({});
    const paused = renderContinuedPages(fetchNext, FIRST_PAGE, true);
    const empty = renderContinuedPages(fetchNext, null);

    act(() => paused.result.current.loadMore());
    act(() => empty.result.current.loadMore());

    expect([fetchNext.mock.calls, empty.result.current.items, empty.result.current.hasMore]).toStrictEqual([[], [], false]);
  });
});
