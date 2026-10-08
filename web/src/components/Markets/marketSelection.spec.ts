import {
  afterEach, describe, expect, it
} from 'vitest';
import {
  ALL_MARKETS_LABEL,
  applicableMarketChoice,
  decodeMarketChoice,
  encodeMarketChoice,
  hasUnassignedKeywords,
  keywordMarketId,
  MARKET_STORAGE_KEY,
  marketChoiceOptions,
  marketName,
  NO_MARKET_LABEL,
  readStoredMarketChoice,
  storeMarketChoice,
  withMarketLabel,
} from './marketSelection';
import {
  BRAZIL, CHILE
} from './markets-fixtures';

afterEach(() => {
  localStorage.clear();
});

describe('keywordMarketId', () => {
  it.each([
    ['a market id', { market_id: 'cl-es' }, 'cl-es'],
    ['no market id', {}, 'global'],
    ['a null market id', { market_id: null }, 'global'],
    ['an empty market id', { market_id: '' }, 'global'],
  ])('reads %s as %s', (_description, keyword, expected) => {
    expect(keywordMarketId(keyword)).toBe(expected);
  });
});

describe('hasUnassignedKeywords', () => {
  it('is true when one keyword has no market', () => {
    expect(hasUnassignedKeywords([{ market_id: 'cl-es' }, {}])).toBe(true);
  });

  it('is false when every keyword has a market', () => {
    expect(hasUnassignedKeywords([{ market_id: 'cl-es' }, { market_id: 'br-pt' }])).toBe(false);
  });
});

describe('marketChoiceOptions', () => {
  it('offers combined, each market and "No market" when some keyword has none', () => {
    expect(marketChoiceOptions([CHILE, BRAZIL], true)).toStrictEqual([
      {
        value: 'all',
        label: ALL_MARKETS_LABEL,
      },
      {
        value: 'cl-es',
        label: 'Chile (Spanish)',
      },
      {
        value: 'br-pt',
        label: 'Brazil (Portuguese)',
      },
      {
        value: 'global',
        label: NO_MARKET_LABEL,
      },
    ]);
  });

  it('leaves "No market" out when every keyword has a market', () => {
    expect(marketChoiceOptions([CHILE], false).map((option) => option.value)).toStrictEqual(['all', 'cl-es']);
  });
});

describe('decodeMarketChoice and encodeMarketChoice', () => {
  it.each([
    [null, null],
    ['', null],
    ['all', null],
    ['cl-es', 'cl-es'],
    ['global', 'global'],
  ])('decodes %s as %s', (value, choice) => {
    expect(decodeMarketChoice(value)).toBe(choice);
  });

  it('encodes every market combined as "all"', () => {
    expect(encodeMarketChoice(null)).toBe('all');
  });

  it('encodes a market as its id', () => {
    expect(encodeMarketChoice('br-pt')).toBe('br-pt');
  });
});

describe('applicableMarketChoice', () => {
  it('keeps a remembered market while the markets are loading', () => {
    expect(applicableMarketChoice('cl-es', [], false, true)).toBe('cl-es');
  });

  it('keeps a configured market', () => {
    expect(applicableMarketChoice('cl-es', [CHILE], true, true)).toBe('cl-es');
  });

  it('falls back to every market for a market no longer configured', () => {
    expect(applicableMarketChoice('br-pt', [CHILE], true, true)).toBeNull();
  });

  it('keeps "No market" while some keyword has none', () => {
    expect(applicableMarketChoice('global', [CHILE], true, true)).toBe('global');
  });

  it('drops "No market" once every keyword has a market', () => {
    expect(applicableMarketChoice('global', [CHILE], true, false)).toBeNull();
  });

  it('drops "No market" when no market is configured', () => {
    expect(applicableMarketChoice('global', [], true, true)).toBeNull();
  });
});

describe('marketName and withMarketLabel', () => {
  it('names a configured market by its name', () => {
    expect(marketName('br-pt', [CHILE, BRAZIL])).toBe('Brazil (Portuguese)');
  });

  it('names the global market "No market"', () => {
    expect(marketName('global', [CHILE])).toBe('No market');
  });

  it('names an unknown market by its id', () => {
    expect(marketName('xx-yy', [CHILE])).toBe('xx-yy');
  });

  it('appends the market to a label', () => {
    expect(withMarketLabel('Hotel Sol', 'cl-es', [CHILE])).toBe('Hotel Sol · Chile (Spanish)');
  });

  it('names the market the API label ends with by its id', () => {
    expect(withMarketLabel('Hotel Sol, market cl-es', 'cl-es', [CHILE])).toBe('Hotel Sol · Chile (Spanish)');
  });

  it('leaves a label without a market unchanged', () => {
    expect(withMarketLabel('All keywords', null, [CHILE])).toBe('All keywords');
  });
});

describe('stored market choice', () => {
  it('remembers a market', () => {
    storeMarketChoice('cl-es');

    expect(readStoredMarketChoice()).toBe('cl-es');
  });

  it('forgets the choice for every market combined', () => {
    storeMarketChoice('cl-es');
    storeMarketChoice(null);

    expect(localStorage.getItem(MARKET_STORAGE_KEY)).toBeNull();
  });

  it('reads nothing stored as every market combined', () => {
    expect(readStoredMarketChoice()).toBeNull();
  });
});
