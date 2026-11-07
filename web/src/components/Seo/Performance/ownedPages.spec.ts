import {
  describe, expect, it
} from 'vitest';
import {
  SUGGESTED_PAGES_LIMIT, ownedHomepage, suggestedPages
} from './ownedPages';

describe('ownedHomepage', () => {
  it('returns the https homepage of the first own domain', () => {
    expect(ownedHomepage(['example.com', 'example.org'])).toBe('https://example.com/');
  });

  it('drops a scheme and path typed into Brand Tracking', () => {
    expect(ownedHomepage([' http://www.example.com/hotels?x=1 '])).toBe('https://www.example.com/');
  });

  it('returns an empty string when Brand Tracking has no own domain', () => {
    expect(ownedHomepage([])).toBe('');
  });

  it('returns an empty string when the first own domain is blank', () => {
    expect(ownedHomepage(['   '])).toBe('');
  });
});

describe('suggestedPages', () => {
  it('lists the sample pages before the crawled pages without repeats', () => {
    expect(suggestedPages(['https://a.test/', 'https://a.test/x'], ['https://a.test/x', 'https://a.test/y']))
      .toStrictEqual(['https://a.test/', 'https://a.test/x', 'https://a.test/y']);
  });

  it(`caps the suggestions at ${String(SUGGESTED_PAGES_LIMIT)} pages`, () => {
    const crawled = Array.from({ length: 80 }, (_, index) => `https://a.test/${String(index)}`);

    expect(suggestedPages([], crawled)).toHaveLength(SUGGESTED_PAGES_LIMIT);
  });
});
