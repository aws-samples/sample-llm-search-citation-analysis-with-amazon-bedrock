import {
  describe, expect, it
} from 'vitest';
import { buildKeywordRow } from '../../../api/seo-fixtures';
import {
  EMPTY_FILTERS, activeFilterCount, filterKeywordRows, nextSort, parseBound, sortKeywordRows
} from './keywordExplorerFilters';

const easy = buildKeywordRow({
  keyword: 'hotel zurich',
  search_volume: 900,
  keyword_difficulty: 12,
  cpc: 0.8,
  intent: 'commercial',
});
const hard = buildKeywordRow({
  keyword: 'luxury hotel zurich',
  search_volume: 300,
  keyword_difficulty: 71,
  cpc: 2.4,
  intent: 'transactional',
});
const unknownDifficulty = buildKeywordRow({
  keyword: 'hotel zurich lake',
  search_volume: null,
  keyword_difficulty: null,
  cpc: null,
  intent: 'unknown',
});
const rows = [easy, hard, unknownDifficulty];

describe('filterKeywordRows', () => {
  it('drops a row with unknown difficulty when a max difficulty is set', () => {
    expect(filterKeywordRows(rows, {
      ...EMPTY_FILTERS,
      maxDifficulty: '30',
    })).toStrictEqual([easy]);
  });

  it('keeps a row with unknown difficulty when no difficulty bound is set', () => {
    expect(filterKeywordRows(rows, EMPTY_FILTERS)).toStrictEqual(rows);
  });

  it('drops a row with unknown volume when a min volume is set', () => {
    expect(filterKeywordRows(rows, {
      ...EMPTY_FILTERS,
      minVolume: '0',
    })).toStrictEqual([easy, hard]);
  });

  it('keeps only rows containing every include term', () => {
    expect(filterKeywordRows(rows, {
      ...EMPTY_FILTERS,
      include: 'hotel, Luxury',
    })).toStrictEqual([hard]);
  });

  it('drops rows containing any exclude term', () => {
    expect(filterKeywordRows(rows, {
      ...EMPTY_FILTERS,
      exclude: 'lake+luxury',
    })).toStrictEqual([easy]);
  });

  it('keeps rows matching any selected intent', () => {
    expect(filterKeywordRows(rows, {
      ...EMPTY_FILTERS,
      intents: ['transactional', 'unknown'],
    })).toStrictEqual([hard, unknownDifficulty]);
  });

  it('keeps rows within the CPC range inclusive', () => {
    expect(filterKeywordRows(rows, {
      ...EMPTY_FILTERS,
      minCpc: '0.8',
      maxCpc: '2',
    })).toStrictEqual([easy]);
  });
});

describe('sortKeywordRows', () => {
  it('puts unknown difficulty last when sorting descending', () => {
    expect(sortKeywordRows(rows, {
      field: 'keyword_difficulty',
      direction: 'desc',
    }).map((row) => row.keyword)).toStrictEqual(['luxury hotel zurich', 'hotel zurich', 'hotel zurich lake']);
  });

  it('puts unknown difficulty last when sorting ascending', () => {
    expect(sortKeywordRows([unknownDifficulty, hard, easy], {
      field: 'keyword_difficulty',
      direction: 'asc',
    }).map((row) => row.keyword)).toStrictEqual(['hotel zurich', 'luxury hotel zurich', 'hotel zurich lake']);
  });

  it('sorts keywords alphabetically when sorting by keyword ascending', () => {
    expect(sortKeywordRows(rows, {
      field: 'keyword',
      direction: 'asc',
    }).map((row) => row.keyword)).toStrictEqual(['hotel zurich', 'hotel zurich lake', 'luxury hotel zurich']);
  });
});

describe('nextSort', () => {
  it('sorts a newly clicked column descending', () => {
    expect(nextSort({
      field: 'search_volume',
      direction: 'asc',
    }, 'cpc')).toStrictEqual({
      field: 'cpc',
      direction: 'desc',
    });
  });

  it('flips the direction when the sorted column is clicked again', () => {
    expect(nextSort({
      field: 'cpc',
      direction: 'desc',
    }, 'cpc')).toStrictEqual({
      field: 'cpc',
      direction: 'asc',
    });
  });
});

describe('parseBound', () => {
  it('returns null for an empty or non-numeric bound', () => {
    expect([parseBound(''), parseBound('  '), parseBound('abc')]).toStrictEqual([null, null, null]);
  });

  it('returns zero for a zero bound', () => {
    expect(parseBound('0')).toBe(0);
  });
});

describe('activeFilterCount', () => {
  it('counts each set bound, term field and the intent choice once', () => {
    expect(activeFilterCount({
      ...EMPTY_FILTERS,
      include: 'hotel',
      maxDifficulty: '30',
      intents: ['commercial', 'unknown'],
    })).toBe(3);
  });
});
