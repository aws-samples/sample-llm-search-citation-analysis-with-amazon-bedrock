import {
  describe, expect, it, vi
} from 'vitest';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  fetchAllSearches, fetchKeywordSearches, isSearchesPage, SearchPageError
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

describe('fetchAllSearches', () => {
  it('returns every run of every page in page order', async () => {
    answerSearchPages(TWO_SEARCH_PAGES);

    expect(await fetchAllSearches()).toStrictEqual([NEWER_RUN, OLDER_RUN]);
  });

  it('asks for the largest pages the API serves', async () => {
    answerSearchPages({ '': [[NEWER_RUN], null] });

    await fetchAllSearches();

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith('https://api.test.com/searches?limit=500', expect.anything());
  });

  it('rejects when the API repeats a token', async () => {
    answerSearchPages({
      '': [[NEWER_RUN], 'loop'],
      loop: [[OLDER_RUN], 'loop'],
    });

    await expect(fetchAllSearches()).rejects.toThrow(new SearchPageError('Searches API repeated a continuation token'));
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

    expect(await fetchKeywordSearches('vuelos a cusco')).toStrictEqual([NEWER_RUN, OLDER_RUN]);
  });

  it('stops once it holds the newest max rows', async () => {
    const third = {
      ...OLDER_RUN,
      timestamp: '2026-09-16T10:00:00Z',
    };
    answerSearchPages({
      '': [[NEWER_RUN, OLDER_RUN], 'older'],
      older: [[third], null],
    });

    expect(await fetchKeywordSearches('vuelos a cusco', 1)).toStrictEqual([NEWER_RUN]);
  });

  it('rejects a malformed page', async () => {
    answerSearchPages({});
    mockAuthenticatedFetch.mockResolvedValue(new Response(JSON.stringify({ searches: [] })));

    await expect(fetchKeywordSearches('vuelos a cusco')).rejects.toThrow(new SearchPageError('Searches API returned an invalid page'));
  });
});
