import {
  describe, expect, it
} from 'vitest';

import {
  isAuthoritativeKeywordsResponse,
  isKeyword,
  isKeywordStatus,
  isKeywordsResponse,
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

describe('isKeywordsResponse', () => {
  it('accepts a response whose keywords are all valid', () => {
    expect(isKeywordsResponse({ keywords: [validKeyword] })).toBe(true);
  });

  it('rejects a response whose keywords field is null instead of an array', () => {
    // Regression shape from AUDIT-2026-08-19 2.17: a key-only check would
    // let `null` flow into array-typed state.
    expect(isKeywordsResponse({ keywords: null })).toBe(false);
  });

  it('rejects a response containing a malformed keyword', () => {
    expect(isKeywordsResponse({ keywords: [validKeyword, { id: 42 }] })).toBe(false);
  });
});

describe('isAuthoritativeKeywordsResponse', () => {
  it('accepts a complete response whose count matches the keyword list', () => {
    expect(isAuthoritativeKeywordsResponse({
      keywords: [validKeyword],
      count: 1,
      complete: true,
    })).toBe(true);
  });

  it('rejects a response whose count disagrees with the keyword list', () => {
    expect(isAuthoritativeKeywordsResponse({
      keywords: [validKeyword],
      count: 2,
      complete: true,
    })).toBe(false);
  });

  it('rejects a response that is not marked complete', () => {
    expect(isAuthoritativeKeywordsResponse({
      keywords: [validKeyword],
      count: 1,
      complete: false,
    })).toBe(false);
  });
});
