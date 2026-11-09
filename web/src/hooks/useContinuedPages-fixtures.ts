import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  expect, vi
} from 'vitest';
import type { CursorPage } from '../api/cursorPages';
import {
  useContinuedPages, type ContinuedPages, type NextPageFetcher
} from './useContinuedPages';

/** A first page of two items, continued by `page-2`. */
export const FIRST_PAGE: CursorPage<string> = {
  items: ['a', 'b'],
  nextToken: 'page-2',
};

/** Another query's first page. */
export const OTHER_FIRST_PAGE: CursorPage<string> = {
  items: ['x'],
  nextToken: 'other-2',
};

/** The last page: `items`, no token. */
export function lastPage(...items: string[]): CursorPage<string> {
  return {
    items,
    nextToken: null,
  };
}

/** A fetcher answering each token with its page in `pages`. */
export function pageFetcher(pages: Record<string, CursorPage<string>>) {
  return vi.fn<NextPageFetcher<string>>((token) => Promise.resolve(pages[token]));
}

interface ContinuedPagesProps {
  readonly first: CursorPage<string> | null;
  readonly fetchNext: NextPageFetcher<string>;
  readonly paused?: boolean;
}

/** `useContinuedPages` over string items (each its own key), re-rendered with new props by `rerender`. */
export function renderContinuedPages(
  fetchNext: NextPageFetcher<string>, first: CursorPage<string> | null = FIRST_PAGE, paused = false,
) {
  const initialProps: ContinuedPagesProps = {
    first,
    fetchNext,
    paused,
  };
  return renderHook((props: ContinuedPagesProps) => useContinuedPages(props.first, props.fetchNext, (item) => item, props.paused), {initialProps,});
}

/** `renderContinuedPages(fetchNext)` with the next page already asked for. */
export function renderAfterLoadMore(fetchNext: NextPageFetcher<string>) {
  const rendered = renderContinuedPages(fetchNext);
  act(() => rendered.result.current.loadMore());
  return rendered;
}

/** Re-renders `rendered` over `OTHER_FIRST_PAGE`, as a new sort or filter does. */
export function switchToOtherQuery(
  rendered: ReturnType<typeof renderContinuedPages>, fetchNext: NextPageFetcher<string>,
): void {
  rendered.rerender({
    first: OTHER_FIRST_PAGE,
    fetchNext,
  });
}

/** `renderAfterLoadMore(fetchNext)`, then, once `settled` holds for the first request, the next page asked for too. */
export async function renderLoadingTwice(
  fetchNext: NextPageFetcher<string>, settled: (pages: ContinuedPages<string>) => boolean,
): Promise<ReturnType<typeof renderContinuedPages>> {
  const rendered = renderAfterLoadMore(fetchNext);
  await waitFor(() => expect(settled(rendered.result.current)).toBe(true));
  act(() => rendered.result.current.loadMore());
  return rendered;
}
