import {
  exportTableIn, runGrid, searchBusinessesFor, searchLocalResults, setupLocalSeoPage
} from './LocalSeoView-fixtures';
import { searchBusinesses } from './localSeoApi-fixtures';
import {
  buildGridResult, buildListing, buildLocalSerpResponse, buildSearchResponse
} from '../../../api/seoLocal-fixtures';
import { EXPORT_EXCEL_LABEL } from '../../ui/ExportExcelButton';
import { screen } from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';

vi.mock('../../../api/seo', () => import('./localSeoApi-fixtures'));
vi.mock('../../../exporters/tableExcel', () => import('../../../test/tableExcelMock'));
vi.mock('../../../api/seoLocal', () => import('./localSeoApi-fixtures'));
vi.mock('../../../hooks/useSeoSettings');

const UNRATED = buildListing({
  title: 'Unrated',
  cid: '1',
  rating: null,
});
const RATED = buildListing({
  title: 'Rated',
  cid: '2',
  rating: 3,
});
const [FIRST_RESULT, MATCHED_RESULT] = buildLocalSerpResponse().items;

beforeEach(setupLocalSeoPage);

describe.each([
  {
    table: 'businesses',
    open: () => searchBusinessesFor('cafe'),
    region: '1 business',
    named: ['Businesses', 'local-businesses', 'cafe Santiago'],
  },
  {
    table: 'local results',
    open: () => searchLocalResults('coffee'),
    region: 'Results for “coffee”',
    named: ['Local results', 'local-results', 'coffee Santiago'],
  },
  {
    table: 'rank grid',
    open: runGrid,
    region: 'Ranks for “coffee”',
    named: ['Rank grid', 'local-rank-grid', 'coffee Santiago'],
  },
])('the $table Excel export', ({
  open, region, named
}) => {
  it('names the sheet and file after the table, the search and the market city', async () => {
    const exported = await exportTableIn(await open(), region);

    expect([exported?.sheetName, exported?.filePrefix, exported?.scopeLabel]).toStrictEqual(named);
  });
});

describe('Local SEO Excel rows', () => {
  it('exports the businesses as listed, in the chosen sort', async () => {
    searchBusinesses.mockResolvedValue(buildSearchResponse([UNRATED, RATED]));

    const exported = await exportTableIn(await searchBusinessesFor('bakery', 'rating'), '2 businesses');

    expect(exported?.rows).toStrictEqual([RATED, UNRATED]);
  });

  it('disables the businesses export when no business matched', async () => {
    searchBusinesses.mockResolvedValue(buildSearchResponse([]));
    await searchBusinessesFor('nothing');
    await screen.findByRole('region', { name: '0 businesses' });

    expect(screen.getByRole('button', { name: EXPORT_EXCEL_LABEL })).toBeDisabled();
  });

  it('exports every local result shown, marking your business', async () => {
    const exported = await exportTableIn(await searchLocalResults('coffee'), 'Results for “coffee”');

    expect(exported?.rows).toStrictEqual([
      {
        item: FIRST_RESULT,
        yours: false,
      },
      {
        item: MATCHED_RESULT,
        yours: true,
      },
    ]);
  });

  it('exports one row per rank grid point', async () => {
    const exported = await exportTableIn(await runGrid(), 'Ranks for “coffee”');

    expect(exported?.rows).toStrictEqual(buildGridResult().points);
  });
});
