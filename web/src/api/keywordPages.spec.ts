import {
  describe, expect, it, vi
} from 'vitest';
import {
  KeywordPageError, fetchAllKeywords
} from './keywordPages';
import {
  KEYWORDS_PAGE_URL, buildKeyword, buildKeywordsPage, stubKeywordPages
} from './keywordPages-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { ApiRequestError } from '../infrastructure';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const januaryKeyword = buildKeyword('january', '2026-01-01T00:00:00Z');
const februaryKeyword = buildKeyword('february', '2026-02-01T00:00:00Z');
const marchKeyword = buildKeyword('march', '2026-03-01T00:00:00Z');
const SECOND_PAGE_URL = `${KEYWORDS_PAGE_URL}?next_token=page-2`;
const AUTHORITATIVE_FIRST_PAGE_URL = `${KEYWORDS_PAGE_URL}?authoritative=true`;
const AUTHORITATIVE_SECOND_PAGE_URL = `${KEYWORDS_PAGE_URL}?authoritative=true&next_token=page-2`;

const twoOrdinaryPages = [
  {
    url: KEYWORDS_PAGE_URL,
    payload: buildKeywordsPage([januaryKeyword, marchKeyword], 'page-2'),
  },
  {
    url: SECOND_PAGE_URL,
    payload: buildKeywordsPage([februaryKeyword]),
  },
];

const januaryPageBeforePageTwo = {
  url: KEYWORDS_PAGE_URL,
  payload: buildKeywordsPage([januaryKeyword], 'page-2'),
};

describe('fetchAllKeywords', () => {
  it('returns the keywords of every page newest first when the API returns two pages', async () => {
    stubKeywordPages(twoOrdinaryPages);

    const keywords = await fetchAllKeywords();

    expect(keywords.map((keyword) => keyword.id)).toStrictEqual(['march', 'february', 'january']);
  });

  it('requests the next page with the previous page token until the token is null', async () => {
    stubKeywordPages(twoOrdinaryPages);

    await fetchAllKeywords();

    expect(mockAuthenticatedFetch.mock.calls.map(([url]) => url)).toStrictEqual([
      KEYWORDS_PAGE_URL,
      SECOND_PAGE_URL,
    ]);
  });

  it('forwards authoritative=true on every page when the read is authoritative', async () => {
    stubKeywordPages([
      {
        url: AUTHORITATIVE_FIRST_PAGE_URL,
        payload: buildKeywordsPage([januaryKeyword], 'page-2'),
      },
      {
        url: AUTHORITATIVE_SECOND_PAGE_URL,
        payload: buildKeywordsPage([februaryKeyword]),
      },
    ]);

    await fetchAllKeywords({ authoritative: true });

    expect(mockAuthenticatedFetch.mock.calls.map(([url]) => url)).toStrictEqual([
      AUTHORITATIVE_FIRST_PAGE_URL,
      AUTHORITATIVE_SECOND_PAGE_URL,
    ]);
  });

  it('passes the caller abort signal to every page request', async () => {
    stubKeywordPages(twoOrdinaryPages);
    const controller = new AbortController();

    await fetchAllKeywords({ signal: controller.signal });

    expect(mockAuthenticatedFetch.mock.calls.map(([, init]) => init?.signal)).toStrictEqual([
      controller.signal,
      controller.signal,
    ]);
  });

  it('URL-encodes the continuation token when it contains reserved characters', async () => {
    const encodedUrl = `${KEYWORDS_PAGE_URL}?next_token=a%2Bb%2Fc%3D`;
    stubKeywordPages([
      {
        url: KEYWORDS_PAGE_URL,
        payload: buildKeywordsPage([], 'a+b/c='),
      },
      {
        url: encodedUrl,
        payload: buildKeywordsPage([januaryKeyword]),
      },
    ]);

    const keywords = await fetchAllKeywords();

    expect(keywords).toStrictEqual([januaryKeyword]);
  });

  it('keeps page order for keywords whose timestamps are equal', async () => {
    const first = buildKeyword('first', '2026-01-01T00:00:00Z');
    const second = buildKeyword('second', '2026-01-01T00:00:00Z');
    stubKeywordPages([{
      url: KEYWORDS_PAGE_URL,
      payload: buildKeywordsPage([first, second]),
    }]);

    const keywords = await fetchAllKeywords();

    expect(keywords).toStrictEqual([first, second]);
  });

  it('rejects with KeywordPageError after two requests when the API repeats a token', async () => {
    stubKeywordPages([
      januaryPageBeforePageTwo,
      {
        url: SECOND_PAGE_URL,
        payload: buildKeywordsPage([februaryKeyword], 'page-2'),
      },
    ]);

    await expect(fetchAllKeywords()).rejects.toThrow(
      new KeywordPageError('Keywords API repeated a continuation token')
    );
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects with KeywordPageError when a page does not match the page shape', async () => {
    stubKeywordPages([{
      url: KEYWORDS_PAGE_URL,
      payload: { keywords: [januaryKeyword] },
    }]);

    await expect(fetchAllKeywords()).rejects.toThrow(
      new KeywordPageError('Keywords API returned an invalid page')
    );
  });

  it('rejects with ApiRequestError when a later page fails', async () => {
    stubKeywordPages([
      januaryPageBeforePageTwo,
      {
        url: SECOND_PAGE_URL,
        payload: {},
        status: 500,
      },
    ]);

    await expect(fetchAllKeywords()).rejects.toBeInstanceOf(ApiRequestError);
  });
});
