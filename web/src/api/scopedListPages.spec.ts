import {
  CursorExpiredError, fetchListPage, listPageParams, readListPage, type ListPaging
} from './scopedListPages';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { fixtureBody } from '../types/domain/scopeCoverage-fixtures';
import { isRecord } from '../types/domain/keywordDecoders';
import { fixtureList } from '../test/scopedFixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const VISIBILITY_KEYWORDS: ListPaging = {
  list: 'keywords',
  token: 'keywords_next_token',
  total: 'keywords_total',
  view: 'keywords',
};
const COMPETITOR_OUTRANKED: ListPaging = {
  list: 'rollup.outranked_keywords',
  token: 'rollup.outranked_keywords_next_token',
  total: 'rollup.outranked_keywords_total',
  view: null,
};
const visibilityRequest = {
  path: '/visibility',
  params: new URLSearchParams({ scope: 'all' }),
};
const VISIBILITY_SOURCE = {
  request: visibilityRequest,
  paging: VISIBILITY_KEYWORDS,
  isItem: isRecord,
};
const complete = fixtureBody('visibility', 'complete');
const page = fixtureBody('visibility', 'page');
const expired = fixtureBody('visibility', 'cursor_expired');

describe('readListPage', () => {
  it('reads the first page, its cursor and total from a scoped body', () => {
    const first = readListPage(complete, VISIBILITY_KEYWORDS, isRecord);

    expect([first?.items.length, first?.nextToken, first?.total]).toStrictEqual([
      fixtureList('visibility', 'complete', 'keywords').length,
      Reflect.get(Object(complete), 'keywords_next_token'),
      Reflect.get(Object(complete), 'keywords_total'),
    ]);
  });

  it('reads the cursor of a view page from next_token', () => {
    expect(readListPage(page, VISIBILITY_KEYWORDS, isRecord, true)?.nextToken).toBe(Reflect.get(Object(page), 'next_token'));
  });

  it('reads a list nested in the body', () => {
    const competitor = fixtureBody('reports-competitor', 'complete');

    expect(readListPage(competitor, COMPETITOR_OUTRANKED, isRecord)?.total)
      .toBe(Reflect.get(Reflect.get(Object(competitor), 'rollup'), 'outranked_keywords_total'));
  });

  it('answers null for a body from an API build without the list', () => {
    expect(readListPage({}, VISIBILITY_KEYWORDS, isRecord)).toBeNull();
  });

  it('answers a page without cursor or total for an older body that has only the list', () => {
    expect(readListPage({ keywords: [] }, VISIBILITY_KEYWORDS, isRecord)).toStrictEqual({
      items: [],
      nextToken: null,
      total: null,
    });
  });
});

describe('listPageParams', () => {
  it('adds the page view and the cursor to the scope query', () => {
    expect(listPageParams(visibilityRequest, VISIBILITY_KEYWORDS, 'tok-2')).toStrictEqual({
      scope: 'all',
      view: 'keywords',
      next_token: 'tok-2',
    });
  });

  it('asks for the first page with the view\'s own query', () => {
    expect(listPageParams(visibilityRequest, VISIBILITY_KEYWORDS, null)).toStrictEqual({ scope: 'all' });
  });

  it('sends only the cursor for a route without a page view', () => {
    const request = {
      path: '/reports/competitor',
      params: new URLSearchParams({ competitor: 'Meliá' }),
    };

    expect(listPageParams(request, COMPETITOR_OUTRANKED, 'tok-2')).toStrictEqual({
      competitor: 'Meliá',
      next_token: 'tok-2',
    });
  });
});

describe('fetchListPage', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('returns the decoded page the cursor points at', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(page));

    const next = await fetchListPage(VISIBILITY_SOURCE, 'tok-2');

    expect(next.items).toStrictEqual(Reflect.get(Object(page), 'keywords'));
  });

  it('throws CursorExpiredError on a 400 cursor_expired answer', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(expired, 400));

    await expect(fetchListPage(VISIBILITY_SOURCE, 'tok-2')).rejects.toThrow(CursorExpiredError);
  });

  it('throws an ApiRequestError with the message of another 400 answer', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      error: 'Invalid next_token',
      field: 'next_token',
    }, 400));

    await expect(fetchListPage(VISIBILITY_SOURCE, 'bad')).rejects.toMatchObject({
      name: 'ApiRequestError',
      message: 'Invalid next_token',
    });
  });
});
