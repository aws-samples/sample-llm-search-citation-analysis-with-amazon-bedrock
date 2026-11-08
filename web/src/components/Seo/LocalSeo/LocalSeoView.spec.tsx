import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import {
  buildListing, buildLocalSerpResponse, buildSearchResponse
} from '../../../api/seoLocal-fixtures';
import {
  fetchBusinessProfile, fetchLocalSerp, isSeoApiConfigured, paidCallCounts, searchBusinesses
} from './localSeoApi-fixtures';
import {
  firstColumnTexts, openFirstBusiness, renderLocalSeo, searchBusinessesFor, searchLocalResults, setupLocalSeoPage
} from './LocalSeoView-fixtures';
import { NOT_SET_UP_TITLE } from '../../KeywordResearch/explorer/KeywordExplorer';

vi.mock('../../../api/seoLocal', () => import('./localSeoApi-fixtures'));
vi.mock('../../../api/seo', () => import('./localSeoApi-fixtures'));
vi.mock('../../../hooks/useSeoSettings');

beforeEach(setupLocalSeoPage);

describe('LocalSeoView setup', () => {
  it('shows the not-set-up state when the SEO API URL is missing', () => {
    isSeoApiConfigured.mockReturnValue(false);

    renderLocalSeo();

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(NOT_SET_UP_TITLE);
  });

  it('makes no paid call when the page opens', () => {
    renderLocalSeo();

    expect(paidCallCounts()).toStrictEqual([0, 0, 0, 0, 0]);
  });
});

describe('Business search tab', () => {
  it('searches around the market city when no coordinate is typed', async () => {
    await searchBusinessesFor('cafe');

    expect(searchBusinesses).toHaveBeenCalledWith(
      {
        market_id: 'cl-es',
        query: 'cafe',
        radius_km: 10,
        sort_by: 'relevance',
        limit: 20 
      }, expect.anything()
    );
  });

  it('lists each business found', async () => {
    await searchBusinessesFor('acme');

    expect(await screen.findByRole('cell', { name: 'Acme Cafe' })).toBeInTheDocument();
  });

  it('sorts businesses without a rating last when sorting by rating', async () => {
    searchBusinesses.mockResolvedValue(buildSearchResponse([
      buildListing({
        title: 'Unrated',
        cid: '1',
        rating: null 
      }), buildListing({
        title: 'Rated',
        cid: '2',
        rating: 3 
      }),
    ]));

    await searchBusinessesFor('bakery', 'rating');
    await screen.findByRole('cell', { name: 'Unrated' });

    expect(firstColumnTexts()).toStrictEqual(['Rated', 'Unrated']);
  });

  it('counts a single business in the singular', async () => {
    searchBusinesses.mockResolvedValue(buildSearchResponse([buildListing({ title: 'Solo' })]));

    await searchBusinessesFor('solo');

    expect(await screen.findByRole('heading', { name: '1 business' })).toBeInTheDocument();
  });

  it('writes review counts with thousands separators', async () => {
    searchBusinesses.mockResolvedValue(buildSearchResponse([buildListing({ reviews_count: 1067 })]));

    await searchBusinessesFor('cafe');

    expect(await screen.findByRole('cell', { name: '1,067' })).toBeInTheDocument();
  });

  it('loads the profile of an opened business by its cid', async () => {
    await openFirstBusiness();

    expect(fetchBusinessProfile).toHaveBeenCalledWith({
      cid: '1234567890',
      market_id: 'cl-es' 
    }, expect.anything());
  });
});

describe('Business profile tab', () => {
  it('states clearly when Google has no questions and answers', async () => {
    const user = await openFirstBusiness();

    await user.click(await screen.findByRole('button', { name: 'Fetch Q&A' }));

    expect(await screen.findByText(/Google returned no questions and answers/)).toBeInTheDocument();
  });

  it('shows no price beside the reviews job', async () => {
    await openFirstBusiness();

    expect(await screen.findByRole('region', { name: 'Reviews' })).not.toHaveTextContent('$');
  });
});

describe('Local results tab', () => {
  it('shows the rank of your business among the results', async () => {
    await searchLocalResults('coffee');

    expect(await screen.findByText('#2')).toBeInTheDocument();
  });

  it('says when your business is not among the results', async () => {
    fetchLocalSerp.mockResolvedValue(buildLocalSerpResponse({ match: null }));

    await searchLocalResults('tea');

    expect(await screen.findByText('Your business is not in the top 2 results.')).toBeInTheDocument();
  });
});
