import {
  describe, expect, it
} from 'vitest';
import {
  emptyFilterForm, keywordConditionCount, keywordFilters, pageConditionCount, pageFilters, parseBound, parseTerms, searchText
} from './domainFilters';

const FORM = {
  ...emptyFilterForm(),
  include: 'Shoes, red',
  exclude: 'free',
  search: ' sale ',
  min: { volume: '100' },
  max: { rank: '10' },
};

describe('parseTerms', () => {
  it('splits on commas and plus signs, lower-cased, without empty terms', () => {
    expect(parseTerms(' Shoes, RED+ ,  ')).toStrictEqual(['shoes', 'red']);
  });
});

describe('parseBound', () => {
  it.each([
    ['12.5', 12.5],
    ['0', 0],
    ['', undefined],
    ['-1', undefined],
    ['abc', undefined],
  ])('reads %j as %j', (text, expected) => {
    expect(parseBound(text)).toBe(expected);
  });
});

describe('condition counts', () => {
  it('counts terms, bounds and the two-condition keyword search', () => {
    expect(keywordConditionCount(FORM, 'subdomains')).toBe(7);
  });

  it('adds four slots for a subfolder scope', () => {
    expect(keywordConditionCount(emptyFilterForm(), 'subfolder')).toBe(4);
  });

  it('counts the page search as one condition and a domain scope as two', () => {
    expect(pageConditionCount({
      ...emptyFilterForm(),
      search: 'blog',
    }, 'domain')).toBe(3);
  });
});

describe('request filters', () => {
  it('sends only the set keyword filters', () => {
    expect(keywordFilters(FORM)).toStrictEqual({
      include: 'Shoes, red',
      exclude: 'free',
      min_volume: 100,
      max_rank: 10,
    });
  });

  it('maps the page bounds to traffic and keywords', () => {
    expect(pageFilters({
      ...emptyFilterForm(),
      min: { keywords: '3' },
      max: { traffic: '50' },
    })).toStrictEqual({
      max_traffic: 50,
      min_keywords: 3,
    });
  });

  it('trims the search and leaves a blank one out', () => {
    expect([searchText(FORM), searchText(emptyFilterForm())]).toStrictEqual(['sale', undefined]);
  });
});
