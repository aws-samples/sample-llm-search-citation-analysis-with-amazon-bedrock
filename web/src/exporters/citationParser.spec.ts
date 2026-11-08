import {
  describe, it, expect 
} from 'vitest';
import {
  isVideoCitation, parseApiResponse
} from './citationParser';
import { MIXED_TYPE_CITATIONS } from './citationParser-fixtures';

// Sorting and filtering the citation list moved to the API (GET /citations
// sorts, filters and pages server-side): lambda/api/test_get_citations_pages.py.

describe('parseApiResponse', () => {
  it('returns empty items array when input is null', () => {
    const result = parseApiResponse(null);

    expect(result.items).toStrictEqual([]);
  });

  it('returns empty items array when input is undefined', () => {
    const result = parseApiResponse(undefined);

    expect(result.items).toStrictEqual([]);
  });

  it('returns empty items array when input is not an object', () => {
    expect(parseApiResponse('string').items).toStrictEqual([]);
    expect(parseApiResponse(123).items).toStrictEqual([]);
    expect(parseApiResponse(true).items).toStrictEqual([]);
  });

  it('returns items array when input has items property', () => {
    const result = parseApiResponse({ items: [1, 2, 3] });

    expect(result.items).toStrictEqual([1, 2, 3]);
  });

  it('returns data as items when input has data property', () => {
    const result = parseApiResponse({ data: ['a', 'b'] });

    expect(result.items).toStrictEqual(['a', 'b']);
  });

  it('prefers items over data when both present', () => {
    const result = parseApiResponse({
      items: [1],
      data: [2] 
    });

    expect(result.items).toStrictEqual([1]);
  });

  it('returns empty items array when items is not an array', () => {
    const result = parseApiResponse({ items: 'not-array' });

    expect(result.items).toStrictEqual([]);
  });

  it('returns empty items array when object has no items or data', () => {
    const result = parseApiResponse({ other: [1, 2] });

    expect(result.items).toStrictEqual([]);
  });
});

describe('isVideoCitation', () => {
  it('is true only for a citation the API tagged as video', () => {
    expect(MIXED_TYPE_CITATIONS.map(isVideoCitation)).toStrictEqual([true, false, false]);
  });
});
