import {
  describe, it, expect 
} from 'vitest';
import {
  parseApiResponse, filterAndSortCitations 
} from './citationParser';
import type { SortConfig } from './citationParser';
import {
  buildCitation, buildCitations 
} from './citationParserFixtures';

const DESC_CITATIONS = {
  column: 'citations',
  direction: 'desc' 
} satisfies SortConfig;
const DESC_KEYWORDS = {
  column: 'keywords',
  direction: 'desc' 
} satisfies SortConfig;
const ASC_CITATIONS = {
  column: 'citations',
  direction: 'asc' 
} satisfies SortConfig;
const ASC_KEYWORDS = {
  column: 'keywords',
  direction: 'asc' 
} satisfies SortConfig;
const DESC_DOMAIN = {
  column: 'domain',
  direction: 'desc' 
} satisfies SortConfig;
const ASC_DOMAIN = {
  column: 'domain',
  direction: 'asc' 
} satisfies SortConfig;

/** One row of the count-column sorting table: which column, which way, and the counts in that order. */
interface CountSortCase {
  column: 'citation_count' | 'keyword_count';
  order: 'ascending' | 'descending';
  sort: SortConfig;
  expected: number[];
}

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

      const result = filterAndSortCitations(citations, '', '', DESC_CITATIONS);

      expect(result).toHaveLength(3);
    });

    it('returns only matching citations when search query provided', () => {
      const citations = [
        buildCitation({ url: 'https://example.com/hotels' }),
        buildCitation({ url: 'https://example.com/restaurants' }),
        buildCitation({ url: 'https://other.com/hotels' }),
      ];

      const result = filterAndSortCitations(citations, 'hotels', '', DESC_CITATIONS);

      expect(result).toHaveLength(2);
      expect(result.every(c => c.url.includes('hotels'))).toBe(true);
    });

    it('matches search query case-insensitively', () => {
      const citations = [buildCitation({ url: 'https://example.com/HOTELS' })];

      const result = filterAndSortCitations(citations, 'hotels', '', DESC_CITATIONS);

      expect(result).toHaveLength(1);
    });

    it('returns empty array when no citations match search query', () => {
      const citations = [buildCitation({ url: 'https://example.com/article' })];

      const result = filterAndSortCitations(citations, 'nonexistent', '', DESC_CITATIONS);

      expect(result).toStrictEqual([]);
    });
  });

  describe('filtering by minimum citations', () => {
    it('keeps even single-citation rows when minCitations is empty string', () => {
      const citations = [
        buildCitation({
          url: 'https://once.com',
          citation_count: 1,
        }),
        buildCitation({
          url: 'https://often.com',
          citation_count: 100,
        }),
      ];

      const result = filterAndSortCitations(citations, '', '', DESC_CITATIONS);

      expect(result.map(c => c.url)).toStrictEqual(['https://often.com', 'https://once.com']);
    });

    it('returns only citations meeting minimum threshold', () => {
      const citations = [
        buildCitation({ citation_count: 10 }),
        buildCitation({ citation_count: 5 }),
        buildCitation({ citation_count: 3 }),
      ];

      const result = filterAndSortCitations(citations, '', 5, DESC_CITATIONS);

      expect(result).toHaveLength(2);
      expect(result.every(c => c.citation_count >= 5)).toBe(true);
    });

    it('returns empty array when no citations meet minimum', () => {
      const citations = [buildCitation({ citation_count: 2 })];

      const result = filterAndSortCitations(citations, '', 10, DESC_CITATIONS);

      expect(result).toStrictEqual([]);
    });
  });

  describe('sorting', () => {
    /** Three citations whose count columns are deliberately out of order. */
    const unsortedCitations = [
      buildCitation({
        url: 'a',
        citation_count: 5,
        keyword_count: 2,
      }),
      buildCitation({
        url: 'b',
        citation_count: 10,
        keyword_count: 5,
      }),
      buildCitation({
        url: 'c',
        citation_count: 3,
        keyword_count: 1,
      }),
    ];

    it.each([
      {
        column: 'citation_count',
        order: 'descending',
        sort: DESC_CITATIONS,
        expected: [10, 5, 3],
      },
      {
        column: 'citation_count',
        order: 'ascending',
        sort: ASC_CITATIONS,
        expected: [3, 5, 10],
      },
      {
        column: 'keyword_count',
        order: 'descending',
        sort: DESC_KEYWORDS,
        expected: [5, 2, 1],
      },
      {
        column: 'keyword_count',
        order: 'ascending',
        sort: ASC_KEYWORDS,
        expected: [1, 2, 5],
      },
    ] satisfies CountSortCase[])('sorts by $column $order when sort is $sort.column $sort.direction', ({
      column, sort, expected
    }) => {
      const result = filterAndSortCitations(unsortedCitations, '', '', sort);

      expect(result.map(c => c[column])).toStrictEqual(expected);
    });

    /** Three citations whose domains are deliberately out of alphabetical order. */
    const unsortedDomainCitations = [
      buildCitation({ url: 'https://zebra.com/page' }),
      buildCitation({ url: 'https://alpha.com/page' }),
      buildCitation({ url: 'https://middle.com/page' }),
    ];

    it.each<[order: string, direction: string, sort: SortConfig, expected: string[]]>([
      ['ascending', 'asc', ASC_DOMAIN, ['https://alpha.com/page', 'https://middle.com/page', 'https://zebra.com/page']],
      ['descending', 'desc', DESC_DOMAIN, ['https://zebra.com/page', 'https://middle.com/page', 'https://alpha.com/page']],
    ])('sorts by domain %s when sort is domain %s', (_order, _direction, sort, expected) => {
      const result = filterAndSortCitations(unsortedDomainCitations, '', '', sort);

      expect(result.map(c => c.url)).toStrictEqual(expected);
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

      const result = filterAndSortCitations(citations, '', '', DESC_KEYWORDS);

      expect(result[0].keyword_count).toBe(3);
      expect(result[1].keyword_count).toBeUndefined();
    });

    it('does not mutate original array', () => {
      const citations = [
        buildCitation({ citation_count: 1 }),
        buildCitation({ citation_count: 5 }),
      ];
      const originalFirst = citations[0];

      filterAndSortCitations(citations, '', '', DESC_CITATIONS);

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

      const result = filterAndSortCitations(citations, 'hotels', 5, DESC_CITATIONS);

      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://a.com/hotels');
    });
  });
});
