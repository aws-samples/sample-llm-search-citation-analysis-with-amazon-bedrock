import {
  describe, expect, it
} from 'vitest';
import {
  activeFilterCount, cleanFilters, conditionCount, conditionLimit, filterTerms
} from './backlinksFilters';
import {
  impliedScope, scopeAllowed
} from './backlinksScope';

describe('conditionCount', () => {
  it('counts every include and exclude term as one condition', () => {
    expect(conditionCount({
      include: 'blog, news+wiki',
      exclude: 'ads',
    })).toBe(4);
  });

  it('counts numeric bounds and flags but not the all link type', () => {
    expect(conditionCount({
      min_domain_rank: 0,
      max_spam_score: 30,
      link_type: 'all',
      hide_lost: true,
      hide_broken: false,
    })).toBe(3);
  });

  it('counts nothing for empty filters', () => {
    expect(conditionCount({ include: ' , ' })).toBe(0);
  });
});

describe('conditionLimit', () => {
  it('leaves 2 conditions for backlinks of a subfolder with spam hidden', () => {
    expect(conditionLimit('backlinks', 'subfolder', false)).toBe(2);
  });

  it('leaves 6 for referring domains with spam hidden, whatever the scope', () => {
    expect(conditionLimit('referring_domains', 'subfolder', false)).toBe(6);
  });

  it('leaves top pages of a domain the whole budget, since they have no spam rule', () => {
    expect(conditionLimit('top_pages', 'domain', false)).toBe(8);
  });

  it('gives back the spam rule conditions when likely spam is included', () => {
    expect(conditionLimit('backlinks', 'domain', true)).toBe(8);
  });
});

describe('filter fields', () => {
  it('splits terms on commas and plus signs', () => {
    expect(filterTerms(' blog ,news+ ')).toStrictEqual(['blog', 'news']);
  });

  it('drops empty texts, false flags and the all link type', () => {
    expect(cleanFilters({
      include: '',
      hide_lost: false,
      link_type: 'all',
      min_rank: 0,
    })).toStrictEqual({ min_rank: 0 });
  });

  it('counts the set filter fields for the badge', () => {
    expect(activeFilterCount({
      include: 'blog',
      exclude: '',
      hide_broken: true,
    })).toBe(2);
  });
});

describe('impliedScope', () => {
  it('reads a bare domain as its subdomains', () => {
    expect(impliedScope('example.com/')).toBe('subdomains');
  });

  it('reads a URL with a path as that subfolder', () => {
    expect(impliedScope('https://example.com/blog')).toBe('subfolder');
  });

  it('refuses a subfolder for an input without a path', () => {
    expect(scopeAllowed('example.com', 'subfolder')).toBe(false);
  });
});
