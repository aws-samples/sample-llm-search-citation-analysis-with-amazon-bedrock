import {
  describe, it, expect 
} from 'vitest';
import {
  parseApiResponse, filterAndSortCitations 
} from './citationParser';
import {
  buildCitation, buildCitations 
} from './citationParserFixtures';

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

describe('filterAndSortCitations', () => {
  describe('filtering by search query', () => {
    it('returns all citations when search query is empty', () => {
      const citations = buildCitations(3);

      const result = filterAndSortCitations(citations, '', '', 'citations');

      expect(result).toHaveLength(3);
    });

    it('returns only matching citations when search query provided', () => {
      const citations = [
        buildCitation({ url: 'https://example.com/hotels' }),
        buildCitation({ url: 'https://example.com/restaurants' }),
        buildCitation({ url: 'https://other.com/hotels' }),
      ];

      const result = filterAndSortCitations(citations, 'hotels', '', 'citations');

      expect(result).toHaveLength(2);
      expect(result.every(c => c.url.includes('hotels'))).toBe(true);
    });

    it('matches search query case-insensitively', () => {
      const citations = [buildCitation({ url: 'https://example.com/HOTELS' })];

      const result = filterAndSortCitations(citations, 'hotels', '', 'citations');

      expect(result).toHaveLength(1);
    });

    it('returns empty array when no citations match search query', () => {
      const citations = [buildCitation({ url: 'https://example.com/article' })];

      const result = filterAndSortCitations(citations, 'nonexistent', '', 'citations');

      expect(result).toStrictEqual([]);
    });
  });

  describe('filtering by minimum citations', () => {
    it('returns all citations when minCitations is empty string', () => {
      const citations = buildCitations(3);

      const result = filterAndSortCitations(citations, '', '', 'citations');

      expect(result).toHaveLength(3);
    });

    it('returns only citations meeting minimum threshold', () => {
      const citations = [
        buildCitation({ citation_count: 10 }),
        buildCitation({ citation_count: 5 }),
        buildCitation({ citation_count: 3 }),
      ];

      const result = filterAndSortCitations(citations, '', 5, 'citations');

      expect(result).toHaveLength(2);
      expect(result.every(c => c.citation_count >= 5)).toBe(true);
    });

    it('returns empty array when no citations meet minimum', () => {
      const citations = [buildCitation({ citation_count: 2 })];

      const result = filterAndSortCitations(citations, '', 10, 'citations');

      expect(result).toStrictEqual([]);
    });
  });

  describe('sorting', () => {
    it('sorts by citation_count descending when sortBy is citations', () => {
      const citations = [
        buildCitation({
          url: 'a',
          citation_count: 5 
        }),
        buildCitation({
          url: 'b',
          citation_count: 10 
        }),
        buildCitation({
          url: 'c',
          citation_count: 3 
        }),
      ];

      const result = filterAndSortCitations(citations, '', '', 'citations');

      expect(result.map(c => c.citation_count)).toStrictEqual([10, 5, 3]);
    });

    it('sorts by keyword_count descending when sortBy is keywords', () => {
      const citations = [
        buildCitation({
          url: 'a',
          keyword_count: 2 
        }),
        buildCitation({
          url: 'b',
          keyword_count: 5 
        }),
        buildCitation({
          url: 'c',
          keyword_count: 1 
        }),
      ];

      const result = filterAndSortCitations(citations, '', '', 'keywords');

      expect(result.map(c => c.keyword_count)).toStrictEqual([5, 2, 1]);
    });

    it('treats undefined keyword_count as 0 when sorting', () => {
      const citations = [
        buildCitation({
          url: 'a',
          keyword_count: undefined 
        }),
        buildCitation({
          url: 'b',
          keyword_count: 3 
        }),
      ];

      const result = filterAndSortCitations(citations, '', '', 'keywords');

      expect(result[0].keyword_count).toBe(3);
      expect(result[1].keyword_count).toBeUndefined();
    });

    it('does not mutate original array', () => {
      const citations = [
        buildCitation({ citation_count: 1 }),
        buildCitation({ citation_count: 5 }),
      ];
      const originalFirst = citations[0];

      filterAndSortCitations(citations, '', '', 'citations');

      expect(citations[0]).toBe(originalFirst);
    });
  });

  describe('combined filtering and sorting', () => {
    it('applies both search and minimum filters before sorting', () => {
      const citations = [
        buildCitation({
          url: 'https://a.com/hotels',
          citation_count: 10 
        }),
        buildCitation({
          url: 'https://b.com/hotels',
          citation_count: 2 
        }),
        buildCitation({
          url: 'https://c.com/restaurants',
          citation_count: 15 
        }),
      ];

      const result = filterAndSortCitations(citations, 'hotels', 5, 'citations');

      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://a.com/hotels');
    });
  });
});
