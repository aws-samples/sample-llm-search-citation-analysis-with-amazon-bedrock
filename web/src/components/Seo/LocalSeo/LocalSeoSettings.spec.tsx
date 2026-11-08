import { screen } from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { CHILE } from '../../Markets/markets-fixtures';
import {
  fetchBusinessProfile, fetchLocalSerp, searchBusinesses
} from './localSeoApi-fixtures';
import {
  BRAND_NAME, MARKET_KEYWORDS, OWNED_DOMAIN, mockLocalSettings, openTab, renderLocalSeo, setupLocalSeoPage
} from './LocalSeoView-fixtures';
import {
  getSettingsLinkElement, suggestionsOf
} from './settingsDefaults-fixtures';

vi.mock('../../../api/seo', () => import('./localSeoApi-fixtures'));
vi.mock('../../../hooks/useSeoSettings');
vi.mock('../../../api/seoLocal', () => import('./localSeoApi-fixtures'));

const TARGET_TABS = ['Local results', 'Local rank grid'];

beforeEach(setupLocalSeoPage);

describe('Business search from Settings', () => {
  it('starts the name at the brand\'s first name', () => {
    renderLocalSeo();

    expect(screen.getByLabelText('Name contains')).toHaveValue(BRAND_NAME);
  });

  it('searches the brand around the market city when Search is pressed without typing', async () => {
    const user = renderLocalSeo();

    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(searchBusinesses).toHaveBeenCalledWith({
      market_id: 'cl-es',
      query: BRAND_NAME,
      radius_km: 10,
      sort_by: 'relevance',
      limit: 20,
    }, expect.anything());
  });

  it('keeps a name the user emptied empty instead of refilling the brand name', async () => {
    const user = renderLocalSeo();

    await user.clear(screen.getByLabelText('Name contains'));

    expect(screen.getByLabelText('Name contains')).toHaveValue('');
  });

  it('shows no Settings link when the brand name and the market city are set', () => {
    renderLocalSeo();

    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('Business profile from Settings', () => {
  it('starts the business name at the brand\'s first name', async () => {
    await openTab('Business profile');

    expect(screen.getByLabelText('Business name')).toHaveValue(BRAND_NAME);
  });

  it('loads no profile when the tab opens with the brand name filled in', async () => {
    await openTab('Business profile');

    expect(fetchBusinessProfile).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });

  it('loads the brand\'s profile when Load profile is pressed without typing', async () => {
    const user = await openTab('Business profile');

    await user.click(screen.getByRole('button', { name: 'Load profile' }));

    expect(fetchBusinessProfile).toHaveBeenCalledWith({
      name: BRAND_NAME,
      market_id: 'cl-es'
    }, expect.anything());
  });
});

describe('Settings links when a value is missing', () => {
  it.each([
    ['Business search', { brandNames: [] }],
    ['Business profile', { brandNames: [] }],
    ['Local results', { ownedDomains: [] }],
    ['Local rank grid', { ownedDomains: [] }],
  ])('links the %s tab to Brand Tracking when the value it starts from is missing', async (tab, missing) => {
    mockLocalSettings(missing);

    await openTab(tab);

    expect(getSettingsLinkElement('Brand Tracking')).toHaveAttribute('href', '/settings/brand');
  });

  it.each(['Business search', 'Business profile', ...TARGET_TABS])(
    'links the %s tab to Markets when the header market has no city', async (tab) => {
      await openTab(tab, CHILE);

      expect(getSettingsLinkElement('Markets')).toHaveAttribute('href', '/settings/markets');
    }
  );
});

describe('Local results and rank grid from Settings', () => {
  it.each(TARGET_TABS)('suggests the header market\'s Settings keywords on the %s tab', async (tab) => {
    await openTab(tab);

    expect(suggestionsOf('Keyword')).toStrictEqual(MARKET_KEYWORDS);
  });

  it.each(TARGET_TABS)('names the brand\'s own domain as the business matched on the %s tab', async (tab) => {
    await openTab(tab);

    expect(screen.getByLabelText(`Your business (empty: ${OWNED_DOMAIN}) by`)).toBeInTheDocument();
  });

  it('sends no business so the server matches the brand\'s own domain', async () => {
    const user = await openTab('Local results');

    await user.type(screen.getByLabelText('Keyword'), 'coffee');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(fetchLocalSerp).toHaveBeenCalledWith({
      keyword: 'coffee',
      search_type: 'maps',
      device: 'mobile',
      depth: 20,
      market_id: 'cl-es',
    }, expect.anything());
  });

  it('keeps Run grid disabled without a market city or a typed point', async () => {
    const user = await openTab('Local rank grid', CHILE);

    await user.type(screen.getByLabelText('Keyword'), 'coffee');

    expect(screen.getByRole('button', { name: 'Run grid' })).toBeDisabled();
  });
});
