import { screen } from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  buildLocalSerpResponse, buildSearchResponse
} from '../../../api/seoLocal-fixtures';
import { mockStartExport } from '../../../test/exportsApiMock';
import { SANTIAGO } from '../../Markets/markets-fixtures';
import {
  fetchLocalSerp, searchBusinesses 
} from './localSeoApi-fixtures';
import {
  exportTableIn, runGrid, searchBusinessesFor, searchLocalResults, setupLocalSeoPage
} from './LocalSeoView-fixtures';

vi.mock('../../../api/seo', () => import('./localSeoApi-fixtures'));
vi.mock('../../../api/exports', () => import('../../../test/exportsApiMock'));
vi.mock('../../../api/seoLocal', () => import('./localSeoApi-fixtures'));
vi.mock('../../../hooks/useSeoSettings');

beforeEach(setupLocalSeoPage);

describe('Local SEO exports', () => {
  it('exports the businesses of the search that was sent, with its sort and result count', async () => {
    await searchBusinessesFor('cafe', 'rating');

    await exportTableIn('1 business');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'seo-local',
      params: {
        count: '20',
        market_id: SANTIAGO.market_id,
        query: 'cafe',
        radius_km: '10',
        sort_by: 'rating',
        table: 'Businesses',
      },
      format: 'xlsx',
    });
  });

  it('disables the businesses export when no business matched', async () => {
    searchBusinesses.mockResolvedValue(buildSearchResponse([]));
    await searchBusinessesFor('nothing');
    await screen.findByRole('region', { name: '0 businesses' });

    expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled();
  });

  it('exports the local results of the search that was sent', async () => {
    await searchLocalResults('coffee');

    await exportTableIn('Results for “coffee”');

    expect(mockStartExport.mock.lastCall?.[0].params).toStrictEqual({
      depth: '20',
      device: 'mobile',
      keyword: 'coffee',
      market_id: SANTIAGO.market_id,
      search_type: 'maps',
      table: 'Local results',
    });
  });

  it('disables the local results export when the search found nothing', async () => {
    fetchLocalSerp.mockResolvedValue(buildLocalSerpResponse({ items: [] }));
    await searchLocalResults('coffee');
    await screen.findByRole('region', { name: 'Results for “coffee”' });

    expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled();
  });

  it('exports the finished rank grid job', async () => {
    await runGrid();

    await exportTableIn('Ranks for “coffee”');

    expect(mockStartExport.mock.lastCall?.[0].params).toStrictEqual({
      job_id: '0123456789abcdef0123456789abcdef',
      table: 'Rank grid',
    });
  });
});
