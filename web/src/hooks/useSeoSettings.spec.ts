import {
  describe, expect, it
} from 'vitest';
import { buildKeyword } from '../api/keywordGroups-fixtures';
import { activeMarketKeywords } from './useSeoSettings';

describe('activeMarketKeywords', () => {
  it('keeps the active keywords of the market', () => {
    const keywords = [
      buildKeyword({
        id: 'k1',
        keyword: 'hotel santiago',
        market_id: 'cl-es',
      }),
      buildKeyword({
        id: 'k2',
        keyword: 'hotel madrid',
        market_id: 'es-es',
      }),
    ];

    expect(activeMarketKeywords(keywords, 'cl-es')).toStrictEqual(['hotel santiago']);
  });

  it('reads the keywords without a market as the global market', () => {
    const keywords = [buildKeyword({
      id: 'k1',
      keyword: 'boutique hotel',
      market_id: null,
    })];

    expect(activeMarketKeywords(keywords, 'global')).toStrictEqual(['boutique hotel']);
  });

  it('leaves out a paused keyword', () => {
    const keywords = [buildKeyword({
      id: 'k1',
      keyword: 'paused hotel',
      status: 'paused',
    })];

    expect(activeMarketKeywords(keywords, null)).toStrictEqual([]);
  });

  it('lists every market sorted and deduplicated when the markets are combined', () => {
    const keywords = [
      buildKeyword({
        id: 'k1',
        keyword: 'spa hotel',
        market_id: 'cl-es',
      }),
      buildKeyword({
        id: 'k2',
        keyword: 'boutique hotel',
      }),
      buildKeyword({
        id: 'k3',
        keyword: 'spa hotel',
        market_id: 'es-es',
      }),
    ];

    expect(activeMarketKeywords(keywords, null)).toStrictEqual(['boutique hotel', 'spa hotel']);
  });
});
