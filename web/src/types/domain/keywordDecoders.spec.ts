import {
  describe, expect, it
} from 'vitest';

import {
  isKeyword,
  isKeywordStatus,
  isKeywordsPage,
  isRecord,
} from './keywordDecoders';

const validKeyword = {
  id: 'kw-1',
  keyword: 'best running shoes',
  created_at: '2026-08-19T00:00:00.000000Z',
  status: 'active',
};

describe('isRecord', () => {
  it('accepts a plain object', () => {
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('rejects null and arrays', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(['not', 'a', 'record'])).toBe(false);
  });
});

describe('isKeywordStatus', () => {
  it('accepts every backend-allowed status and absence', () => {
    expect(isKeywordStatus('active')).toBe(true);
    expect(isKeywordStatus('inactive')).toBe(true);
    expect(isKeywordStatus('paused')).toBe(true);
    expect(isKeywordStatus(undefined)).toBe(true);
  });

  it('rejects statuses outside the backend contract', () => {
    expect(isKeywordStatus('archived')).toBe(false);
    expect(isKeywordStatus(null)).toBe(false);
  });
});

describe('isKeyword', () => {
  it('accepts a keyword with all required fields', () => {
    expect(isKeyword(validKeyword)).toBe(true);
  });

  it('accepts a keyword without the optional status', () => {
    expect(isKeyword({
      id: validKeyword.id,
      keyword: validKeyword.keyword,
      created_at: validKeyword.created_at,
    })).toBe(true);
  });

  it('rejects a keyword missing the id field', () => {
    expect(isKeyword({
      keyword: validKeyword.keyword,
      created_at: validKeyword.created_at,
      status: validKeyword.status,
    })).toBe(false);
  });

  it('rejects a keyword with an out-of-contract status', () => {
    expect(isKeyword({
      ...validKeyword,
      status: 'archived',
    })).toBe(false);
  });
});

describe('isKeywordsPage', () => {
  it('accepts a last page whose count matches the keyword list', () => {
    expect(isKeywordsPage({
      keywords: [validKeyword],
      count: 1,
      next_token: null,
    })).toBe(true);
  });

  it('accepts a page that carries a continuation token', () => {
    expect(isKeywordsPage({
      keywords: [],
      count: 0,
      next_token: 'eyJpZCI6Imt3LTEifQ',
    })).toBe(true);
  });

  it('rejects a page whose keywords field is null instead of an array', () => {
    // Regression shape from AUDIT-2026-08-19 2.17: a key-only check would
    // let `null` flow into array-typed state.
    expect(isKeywordsPage({
      keywords: null,
      count: 0,
      next_token: null,
    })).toBe(false);
  });

  it('rejects a page containing a malformed keyword', () => {
    expect(isKeywordsPage({
      keywords: [validKeyword, { id: 42 }],
      count: 2,
      next_token: null,
    })).toBe(false);
  });

  it('rejects a page whose count disagrees with the keyword list', () => {
    expect(isKeywordsPage({
      keywords: [validKeyword],
      count: 2,
      next_token: null,
    })).toBe(false);
  });

  it.each([
    {
      condition: 'the token is missing',
      page: {
        keywords: [validKeyword],
        count: 1,
      },
    },
    {
      condition: 'the token is an empty string',
      page: {
        keywords: [validKeyword],
        count: 1,
        next_token: '',
      },
    },
    {
      condition: 'the token is not a string',
      page: {
        keywords: [validKeyword],
        count: 1,
        next_token: { id: 'kw-1' },
      },
    },
  ])('rejects a page when $condition', ({ page }) => {
    expect(isKeywordsPage(page)).toBe(false);
  });
});
