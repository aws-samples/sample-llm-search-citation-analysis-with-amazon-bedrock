import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { useScopedList } from './useScopedList';
import {
  act, renderHook
} from '@testing-library/react';
import { createMockJsonResponse } from '../test/fetchResponses';
import { answerFetchesInOrder } from '../test/scopedTestKit';
import {
  fixtureList, scopedFixture
} from '../test/scopedFixtures';
import { isRecord } from '../types/domain/keywordDecoders';
import type { ListPaging } from '../api/scopedListPages';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const PAGING: ListPaging = {
  list: 'keywords',
  token: 'keywords_next_token',
  total: 'keywords_total',
  view: 'keywords',
};
const REQUEST = {
  path: '/visibility',
  params: new URLSearchParams({ scope: 'all' }),
};
const complete = scopedFixture('visibility', 'complete');
const firstRows = fixtureList('visibility', 'complete', 'keywords');
const pageRows = fixtureList('visibility', 'page', 'keywords');
const olderBody = { keywords: [] };
const lastPage = {
  ...scopedFixture('visibility', 'page'),
  next_token: null,
};
const cursorExpired = scopedFixture('visibility', 'cursor_expired');

/**
 * Renders the list over the complete body, answers its fetches with `answers` (the last page by
 * default) and presses load more once.
 */
async function renderListAfterLoadMore(...answers: ReadonlyArray<readonly [unknown, number]>) {
  answerFetchesInOrder(...(answers.length > 0 ? answers : [[lastPage, 200] as const]));
  const { result } = renderHook(() => useScopedList(complete, REQUEST, PAGING, isRecord));
  await act(() => result.current.loadMore?.() ?? Promise.resolve());
  return result;
}

describe('useScopedList', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('holds the first page of the body before any load', () => {
    const { result } = renderHook(() => useScopedList(complete, REQUEST, PAGING, isRecord));

    expect([result.current.items, result.current.total]).toStrictEqual([firstRows, complete.keywords_total]);
  });

  it('appends the next page after the loaded rows', async () => {
    const result = await renderListAfterLoadMore();

    expect(result.current.items).toStrictEqual([...firstRows, ...pageRows]);
  });

  it('requests the page view with the cursor of the body', async () => {
    await renderListAfterLoadMore();

    const url = new URL(String(mockAuthenticatedFetch.mock.calls[0][0]));
    expect([url.searchParams.get('view'), url.searchParams.get('next_token')]).toStrictEqual(['keywords', complete.keywords_next_token]);
  });

  it('offers no load more once the last page is loaded', async () => {
    const result = await renderListAfterLoadMore();

    expect(result.current.loadMore).toBeUndefined();
  });

  it('restarts the list from its first page when the cursor expired', async () => {
    const result = await renderListAfterLoadMore([cursorExpired, 400], [lastPage, 200]);

    expect([result.current.items, result.current.restarted]).toStrictEqual([pageRows, true]);
  });

  it('requests the restarted list without a cursor', async () => {
    await renderListAfterLoadMore([cursorExpired, 400], [lastPage, 200]);

    expect(new URL(String(mockAuthenticatedFetch.mock.calls[1][0])).searchParams.has('next_token')).toBe(false);
  });

  it('keeps the loaded rows and reports the error when a page fails', async () => {
    const result = await renderListAfterLoadMore([{}, 500]);

    expect([result.current.items, result.current.error]).toStrictEqual([firstRows, 'Server error occurred']);
  });

  it('starts over from the new body when the view refetches', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(lastPage));
    const {
      result, rerender
    } = renderHook(({ body }) => useScopedList(body, REQUEST, PAGING, isRecord), { initialProps: { body: complete } });
    await act(() => result.current.loadMore?.() ?? Promise.resolve());

    rerender({ body: scopedFixture('visibility', 'live') });

    expect(result.current.items).toStrictEqual(fixtureList('visibility', 'live', 'keywords'));
  });

  it('offers no load more for a body from an API build without a cursor', () => {
    const { result } = renderHook(() => useScopedList(olderBody, REQUEST, PAGING, isRecord));

    expect(result.current.loadMore).toBeUndefined();
  });
});
