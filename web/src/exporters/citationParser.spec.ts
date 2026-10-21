import {
  describe, it, expect 
} from 'vitest';
import {
  CITATION_EXPORT_COLUMNS, citationExportRows, isVideoCitation, parseApiResponse
} from './citationParser';
import {
  MIXED_TYPE_CITATIONS, buildCitation
} from './citationParser-fixtures';

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

describe('citationExportRows', () => {
  it('writes the Type column after the domain, as Video or Page', () => {
    const rows = citationExportRows(MIXED_TYPE_CITATIONS);

    expect(rows.map((row) => [row.Domain, row.Type])).toStrictEqual([
      ['www.youtube.com', 'Video'],
      ['example.com', 'Page'],
      ['example.com', 'Page'],
    ]);
  });

  it('writes rank, URL, counts and the keyword list of each citation', () => {
    const [row] = citationExportRows([buildCitation({
      keyword_count: 2,
      keywords: ['hotels', 'family hotels'],
    })]);

    expect(row).toStrictEqual({
      Rank: 1,
      URL: 'https://example.com/article',
      Domain: 'example.com',
      Type: 'Page',
      Keywords: 2,
      'Citation Count': 5,
      'Keyword List': 'hotels, family hotels',
    });
  });

  it('declares one column width per exported column', () => {
    const [row] = citationExportRows([buildCitation()]);

    expect(CITATION_EXPORT_COLUMNS).toHaveLength(Object.keys(row).length);
  });
});
