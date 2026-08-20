import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import { ApiRequestError } from '../../infrastructure';
import type { Keyword } from '../../types';
import {
  CREATE_ERROR_MESSAGE,
  InvalidKeywordResponseError,
  buildBulkMessage,
  collectBulkResults,
  getBulkAlert,
  getSafeErrorMessage,
  isDuplicateKeyword,
  parseBulkKeywords,
  parseKeywordResponse,
  processBulkKeyword,
} from './keywordEntry';
import type { BulkKeywordResult } from './keywordEntry';

vi.mock('../../api/client', () => ({ apiPost: vi.fn() }));

import { apiPost } from '../../api/client';

const mockApiPost = vi.mocked(apiPost);

const KEYWORD_FIXTURE: Keyword = {
  id: 'kw-1',
  keyword: 'best hotels in madrid',
  created_at: '2026-08-19T00:00:00Z',
  status: 'active',
};

describe('parseKeywordResponse', () => {
  it('returns the keyword when the payload is a valid keyword', () => {
    expect(parseKeywordResponse(KEYWORD_FIXTURE)).toStrictEqual(KEYWORD_FIXTURE);
  });

  it('throws InvalidKeywordResponseError when the payload is malformed', () => {
    expect(() => parseKeywordResponse({ id: 42 })).toThrow(InvalidKeywordResponseError);
    expect(() => parseKeywordResponse({ id: 42 })).toThrow(
      'Keyword API returned a malformed success payload'
    );
  });
});

describe('getSafeErrorMessage', () => {
  it('returns the server message for a definitive client rejection', () => {
    const rejection = new ApiRequestError('Bad request', {
      statusCode: 400,
      responseMessage: 'Keyword exceeds the length limit',
    });

    expect(getSafeErrorMessage(rejection, 'fallback')).toBe('Keyword exceeds the length limit');
  });

  it('returns the fallback when the error is a server failure', () => {
    const serverError = new ApiRequestError('Internal error', {
      statusCode: 500,
      responseMessage: 'stack trace with internals',
    });

    expect(getSafeErrorMessage(serverError, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when the error is not an api error', () => {
    expect(getSafeErrorMessage(new TypeError('boom'), 'fallback')).toBe('fallback');
  });
});

describe('isDuplicateKeyword', () => {
  it('matches ignoring case and surrounding whitespace', () => {
    expect(isDuplicateKeyword('  BEST hotels IN madrid ', [KEYWORD_FIXTURE])).toBe(true);
  });

  it('returns false when the only match is the excluded id', () => {
    expect(isDuplicateKeyword('best hotels in madrid', [KEYWORD_FIXTURE], 'kw-1')).toBe(false);
  });

  it('returns false when no keyword matches', () => {
    expect(isDuplicateKeyword('best hotels in lisbon', [KEYWORD_FIXTURE])).toBe(false);
  });
});

describe('parseBulkKeywords', () => {
  it('splits lines and trims whitespace', () => {
    expect(parseBulkKeywords('  first  \nsecond\n third')).toStrictEqual([
      'first', 'second', 'third',
    ]);
  });

  it('drops empty and whitespace-only lines', () => {
    expect(parseBulkKeywords('first\n\n   \nsecond')).toStrictEqual(['first', 'second']);
  });

  it('dedupes case-insensitively keeping the first occurrence', () => {
    expect(parseBulkKeywords('Hotels\nhotels\nHOTELS\nflights')).toStrictEqual([
      'Hotels', 'flights',
    ]);
  });
});

describe('collectBulkResults', () => {
  it('partitions successes and failures preserving order', () => {
    const failure = {
      keyword: 'bad',
      message: 'rejected',
    };
    const results: BulkKeywordResult[] = [
      {
        outcome: 'success',
        data: KEYWORD_FIXTURE,
      },
      {
        outcome: 'failure',
        failure,
      },
    ];

    expect(collectBulkResults(results)).toStrictEqual({
      addedKeywords: [KEYWORD_FIXTURE],
      failures: [failure],
    });
  });
});

describe('getBulkAlert', () => {
  it('reports success when nothing failed', () => {
    expect(getBulkAlert(3, 0)).toStrictEqual({
      title: 'Success',
      variant: 'success',
    });
  });

  it('reports partial success when some added and some failed', () => {
    expect(getBulkAlert(2, 1)).toStrictEqual({
      title: 'Partial Success',
      variant: 'info',
    });
  });

  it('reports error when every keyword failed', () => {
    expect(getBulkAlert(0, 3)).toStrictEqual({
      title: 'Error',
      variant: 'error',
    });
  });
});

describe('buildBulkMessage', () => {
  it('uses singular forms for one keyword and one duplicate', () => {
    expect(buildBulkMessage(1, 1, [])).toBe('Added 1 keyword. Skipped 1 duplicate');
  });

  it('combines added, skipped, and failure details', () => {
    const failures = [{
      keyword: 'bad one',
      message: 'too long',
    }];

    expect(buildBulkMessage(2, 3, failures)).toBe(
      'Added 2 keywords. Skipped 3 duplicates. Failed: bad one (too long)'
    );
  });
});

describe('processBulkKeyword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a success outcome with the parsed keyword', async () => {
    mockApiPost.mockResolvedValue(KEYWORD_FIXTURE);

    const result = await processBulkKeyword('best hotels in madrid');

    expect(result).toStrictEqual({
      outcome: 'success',
      data: KEYWORD_FIXTURE,
    });
    expect(mockApiPost).toHaveBeenCalledWith(
      '/keywords',
      { keyword: 'best hotels in madrid' },
      { allowStructured4xx: true }
    );
  });

  it('returns a failure with the server message when the API rejects the keyword', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockApiPost.mockRejectedValue(new ApiRequestError('Bad request', {
      statusCode: 400,
      responseMessage: 'Keyword contains control characters',
    }));

    const result = await processBulkKeyword('bad\u0000keyword');

    expect(result).toStrictEqual({
      outcome: 'failure',
      failure: {
        keyword: 'bad\u0000keyword',
        message: 'Keyword contains control characters',
      },
    });
    consoleSpy.mockRestore();
  });

  it('returns the fallback failure message when the API fails without a safe message', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockApiPost.mockRejectedValue(new ApiRequestError('Internal error', { statusCode: 500 }));

    const result = await processBulkKeyword('fine keyword');

    expect(result).toStrictEqual({
      outcome: 'failure',
      failure: {
        keyword: 'fine keyword',
        message: CREATE_ERROR_MESSAGE,
      },
    });
    consoleSpy.mockRestore();
  });
});
