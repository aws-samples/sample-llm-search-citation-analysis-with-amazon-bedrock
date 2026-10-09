import {
  describe, expect, it
} from 'vitest';
import type { Keyword } from '../../types';
import {
  conceptIdOf, linkedKeywords, localizedKeywordBody, marketsAvailableFor
} from './keywordMarkets';
import {
  BRAZIL, buildMarket, CHILE
} from '../Markets/markets-fixtures';

const SOURCE = {
  id: 'k-en',
  keyword: 'cheap flights to Lima',
  created_at: '2026-09-01T00:00:00Z',
  status: 'active',
  group_ids: ['g-altiplano'],
} satisfies Keyword;
const CHILEAN = {
  id: 'k-cl',
  keyword: 'pasajes baratos a Lima',
  created_at: '2026-09-02T00:00:00Z',
  market_id: 'cl-es',
  concept_id: 'k-en',
} satisfies Keyword;
const UNRELATED = {
  id: 'k-other',
  keyword: 'hotels in Lima',
  created_at: '2026-09-03T00:00:00Z',
} satisfies Keyword;
const KEYWORDS = [SOURCE, CHILEAN, UNRELATED];

describe('conceptIdOf', () => {
  it('is the keyword id for a source keyword', () => {
    expect(conceptIdOf(SOURCE)).toBe('k-en');
  });

  it('is the source id for a translation', () => {
    expect(conceptIdOf(CHILEAN)).toBe('k-en');
  });

  it('treats an empty concept as none', () => {
    expect(conceptIdOf({
      id: 'k1',
      concept_id: '',
    })).toBe('k1');
  });
});

describe('linkedKeywords', () => {
  it('finds the translations of a source keyword', () => {
    expect(linkedKeywords(SOURCE, KEYWORDS)).toStrictEqual([CHILEAN]);
  });

  it('finds the source of a translation', () => {
    expect(linkedKeywords(CHILEAN, KEYWORDS)).toStrictEqual([SOURCE]);
  });

  it('finds nothing for a keyword asking its own question', () => {
    expect(linkedKeywords(UNRELATED, KEYWORDS)).toStrictEqual([]);
  });
});

describe('marketsAvailableFor', () => {
  const MEXICO = buildMarket({
    market_id: 'mx-es',
    name: 'Mexico (Spanish)',
  });

  it('leaves out the markets a translation already covers', () => {
    expect(marketsAvailableFor(SOURCE, KEYWORDS, [CHILE, BRAZIL, MEXICO])).toStrictEqual([BRAZIL, MEXICO]);
  });

  it('leaves out the market of the source itself', () => {
    expect(marketsAvailableFor(CHILEAN, [CHILEAN], [CHILE, BRAZIL])).toStrictEqual([BRAZIL]);
  });
});

describe('localizedKeywordBody', () => {
  it('localizes the source in the market and joins its groups', () => {
    expect(localizedKeywordBody(' passagens baratas para Lima ', SOURCE, 'br-pt')).toStrictEqual({
      keyword: 'passagens baratas para Lima',
      market_id: 'br-pt',
      concept_id: 'k-en',
      group_ids: ['g-altiplano'],
    });
  });

  it('keeps the concept of a translation used as the source', () => {
    expect(localizedKeywordBody('passagens', CHILEAN, 'br-pt')).toStrictEqual({
      keyword: 'passagens',
      market_id: 'br-pt',
      concept_id: 'k-en',
    });
  });
});
