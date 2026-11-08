import {
  describe, expect, it, vi
} from 'vitest';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  fetchKeywordSearches, isSearchesPage, SearchPageError
} from './searchPages';
import {
  answerSearchPages, NEWER_RUN, OLDER_RUN, TWO_SEARCH_PAGES
} from './searchPages-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

describe('isSearchesPage', () => {
  it('accepts a page with its rows and a null token', () => {
    expect(isSearchesPage({
      searches: [],
      next_token: null,
    })).toBe(true);
  });

  it('rejects a page whose rows are null', () => {
    expect(isSearchesPage({
      searches: null,
      next_token: null,
    })).toBe(false);
  });

  it('rejects a page without a token', () => {
    expect(isSearchesPage({ searches: [] })).toBe(false);
  });
});

describe('fetchKeywordSearches', () => {
  it('asks for the keyword runs with their answer text', async () => {
    answerSearchPages({ '': [[NEWER_RUN], null] });

    await fetchKeywordSearches('vuelos a cusco');

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/searches?keyword=vuelos+a+cusco&include_response=true&limit=500', expect.anything(),
    );
  });

  it('follows the pages until the API reports the last one', async () => {
    answerSearchPages(TWO_SEARCH_PAGES);

    expect(await fetchKeywordSearches('vuelos a cusco')).toStrictEqual({
      searches: [NEWER_RUN, OLDER_RUN],
      nextToken: null,
    });
  });

  it('stops after the page that reaches max rows and keeps its token for the older runs', async () => {
    const third = {
      ...OLDER_RUN,
      timestamp: '2026-09-16T10:00:00Z',
    };
    answerSearchPages({
      '': [[NEWER_RUN, OLDER_RUN], 'older'],
      older: [[third], null],
    });

    expect(await fetchKeywordSearches('vuelos a cusco', null, 1)).toStrictEqual({
      searches: [NEWER_RUN, OLDER_RUN],
      nextToken: 'older',
    });
  });

  it('continues after the token of the previous batch', async () => {
    const third = {
      ...OLDER_RUN,
      timestamp: '2026-09-16T10:00:00Z',
    };
    answerSearchPages({ older: [[third], null] });

    expect(await fetchKeywordSearches('vuelos a cusco', 'older')).toStrictEqual({
      searches: [third],
      nextToken: null,
    });
  });

  it('rejects a malformed page', async () => {
    answerSearchPages({});
    mockAuthenticatedFetch.mockResolvedValue(new Response(JSON.stringify({ searches: [] })));

    await expect(fetchKeywordSearches('vuelos a cusco')).rejects.toThrow(new SearchPageError('Searches API returned an invalid page'));
  });
});
