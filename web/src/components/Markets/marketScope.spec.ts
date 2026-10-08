import {
  describe, expect, it
} from 'vitest';
import {
  describeScopeMarkets, keywordsInMarkets, scopeMarketIds, withMarketIds
} from './marketScope';

describe('withMarketIds', () => {
  it('narrows a group scope to the markets', () => {
    expect(withMarketIds({
      mode: 'groups',
      group_ids: ['g1'],
    }, ['cl-es', 'global'])).toStrictEqual({
      mode: 'groups',
      group_ids: ['g1'],
      market_ids: ['cl-es', 'global'],
    });
  });

  it('removes the narrowing for an empty list', () => {
    expect(withMarketIds({
      mode: 'all',
      market_ids: ['cl-es'],
    }, [])).toStrictEqual({ mode: 'all' });
  });

  it('does not change the scope it was given', () => {
    const scope = {
      mode: 'all' as const,
      market_ids: ['cl-es'],
    };

    withMarketIds(scope, []);

    expect(scope).toStrictEqual({
      mode: 'all',
      market_ids: ['cl-es'],
    });
  });
});

describe('scopeMarketIds', () => {
  it('reads the markets of a narrowed scope', () => {
    expect(scopeMarketIds({
      mode: 'keywords',
      keyword_ids: ['k1'],
      market_ids: ['br-pt'],
    })).toStrictEqual(['br-pt']);
  });

  it('reads no markets from a missing scope', () => {
    expect(scopeMarketIds(null)).toStrictEqual([]);
  });
});

describe('keywordsInMarkets', () => {
  const keywords = [
    {
      id: 'k1',
      market_id: 'cl-es',
    },
    { id: 'k2' },
    {
      id: 'k3',
      market_id: 'br-pt',
    },
  ];

  it('keeps every keyword without a filter', () => {
    expect(keywordsInMarkets(keywords, []).map((keyword) => keyword.id)).toStrictEqual(['k1', 'k2', 'k3']);
  });

  it('keeps the keywords of the listed markets, global for those without one', () => {
    expect(keywordsInMarkets(keywords, ['cl-es', 'global']).map((keyword) => keyword.id)).toStrictEqual(['k1', 'k2']);
  });
});

describe('describeScopeMarkets', () => {
  it('names the markets of a narrowed scope', () => {
    expect(describeScopeMarkets(['cl-es', 'global'], (id) => id.toUpperCase())).toBe('Markets: CL-ES, GLOBAL');
  });

  it('describes nothing for every market', () => {
    expect(describeScopeMarkets([], (id) => id)).toBeNull();
  });
});
