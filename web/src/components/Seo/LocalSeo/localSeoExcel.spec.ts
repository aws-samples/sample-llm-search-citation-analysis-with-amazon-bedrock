import {
  describe, expect, it
} from 'vitest';
import { excelTableRows } from '../../../exporters/tableExcel';
import {
  buildGridPoint, buildListing, buildLocalSerpResponse, buildResultItem
} from '../../../api/seoLocal-fixtures';
import {
  GRID_COLUMNS, LISTING_COLUMNS, RESULT_COLUMNS, localResultRows, localScopeLabel
} from './localSeoExcel';
import { EMPTY_POINT } from './localSeoRequest';

const LISTING_CELLS = {
  Business: 'Acme Cafe',
  Rating: 4.6,
  Reviews: 120,
  Category: 'Coffee shop',
  Claimed: 'Yes',
  Phone: '+1 555 0100',
  Website: 'https://acme.example.org/',
  Address: '1 Example St',
  Latitude: 40,
  Longitude: -74,
  cid: '1234567890',
  'Place ID': 'ChIJexample-cafe',
};

describe('localScopeLabel', () => {
  it('names the searched terms and the market city when no coordinate is typed', () => {
    expect(localScopeLabel(['cafe', ' coffee_shop '], EMPTY_POINT, 'Santiago')).toBe('cafe coffee_shop Santiago');
  });

  it('leaves the market city out when a coordinate is typed', () => {
    expect(localScopeLabel(['cafe'], {
      latitude: '-33.4',
      longitude: '-70.6'
    }, 'Santiago')).toBe('cafe');
  });

  it('skips empty terms and a missing city', () => {
    expect(localScopeLabel(['', 'bakery'], EMPTY_POINT, null)).toBe('bakery');
  });
});

describe('LISTING_COLUMNS', () => {
  it('writes every field of a listing, numbers as numbers and the full website URL', () => {
    expect(excelTableRows(LISTING_COLUMNS, [buildListing()])).toStrictEqual([LISTING_CELLS]);
  });

  it('leaves unknown values empty, never 0', () => {
    const [cells] = excelTableRows(LISTING_COLUMNS, [buildListing({
      rating: null,
      reviews_count: null,
      is_claimed: null,
      cid: null,
    })]);

    expect([cells?.Rating, cells?.Reviews, cells?.Claimed, cells?.cid]).toStrictEqual(['', '', '', '']);
  });

  it('falls back on the domain when the listing has no website URL', () => {
    const [cells] = excelTableRows(LISTING_COLUMNS, [buildListing({ url: null })]);

    expect(cells?.Website).toBe('acme.example.org');
  });
});

describe('RESULT_COLUMNS', () => {
  it('writes the rank, the business fields and whether it is your business', () => {
    const [, second] = excelTableRows(RESULT_COLUMNS, localResultRows(buildLocalSerpResponse()));

    expect(second).toStrictEqual({
      Rank: 2,
      ...LISTING_CELLS,
      'Your business': 'Yes',
    });
  });

  it('marks every result as not yours when your business is not among them', () => {
    const rows = excelTableRows(RESULT_COLUMNS, localResultRows(buildLocalSerpResponse({ match: null })));

    expect(rows.map((cells) => cells['Your business'])).toStrictEqual(['No', 'No']);
  });

  it('falls back on the group rank when the absolute rank is unknown', () => {
    const [first] = excelTableRows(RESULT_COLUMNS, localResultRows(buildLocalSerpResponse({
      items: [buildResultItem(7, { rank_absolute: null })],
      match: null,
    })));

    expect(first?.Rank).toBe(7);
  });
});

describe('GRID_COLUMNS', () => {
  it('writes one row per grid point with its coordinate, rank and top result', () => {
    expect(excelTableRows(GRID_COLUMNS, [buildGridPoint(4, 2)])).toStrictEqual([{
      Row: 2,
      Column: 2,
      Latitude: 40,
      Longitude: -74,
      Status: 'ready',
      Found: 'Yes',
      Rank: 2,
      Results: 20,
      'Top result': 'Business 1',
    }]);
  });

  it('says not found with an empty rank when a searched point does not rank the business', () => {
    const [cells] = excelTableRows(GRID_COLUMNS, [buildGridPoint(3, null)]);

    expect([cells?.Found, cells?.Rank]).toStrictEqual(['No', '']);
  });

  it('leaves found empty while a point is still pending', () => {
    const [cells] = excelTableRows(GRID_COLUMNS, [buildGridPoint(0, null, 'pending')]);

    expect([cells?.Status, cells?.Found]).toStrictEqual(['pending', '']);
  });
});
