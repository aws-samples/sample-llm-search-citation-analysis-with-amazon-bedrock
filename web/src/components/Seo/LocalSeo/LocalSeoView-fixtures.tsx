import { vi } from 'vitest';
import { exportTableToExcel } from '../../../exporters/tableExcel';
import { EXPORT_EXCEL_LABEL } from '../../ui/ExportExcelButton';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { BrandSettings } from '../../../api/brandSettings';
import type { Market } from '../../../types';
import { MARKET_SELECTION_CONTEXT } from '../../Markets/marketSelectionContext';
import {
  SANTIAGO, buildMarketSelectionMock
} from '../../Markets/markets-fixtures';
import { setupLocalSeoApi } from './localSeoApi-fixtures';
import { LocalSeoView } from './LocalSeoView';
import { mockSettingsReads } from './settingsDefaults-fixtures';

/** The brand's first name and own domain in Settings › Brand Tracking, as the specs' default. */
export const BRAND_NAME = 'Altiplano Cafe';
export const OWNED_DOMAIN = 'altiplano.cl';
export const MARKET_KEYWORDS = ['cafe santiago', 'coffee near me'];

/**
 * Settings as the page reads them (`vi.mock('../../../hooks/useSeoSettings')`): Brand Tracking with `BRAND_NAME`
 * and `OWNED_DOMAIN` unless `overrides` say otherwise, and the market's `MARKET_KEYWORDS`.
 */
export function mockLocalSettings(overrides: Partial<BrandSettings> = {}): void {
  mockSettingsReads({
    brandNames: [BRAND_NAME],
    ownedDomains: [OWNED_DOMAIN],
    ...overrides,
  }, MARKET_KEYWORDS);
}

/** For `beforeEach`: every API call answers its default fixture and Settings are `mockLocalSettings()`. */
export function setupLocalSeoPage(): void {
  setupLocalSeoApi();
  mockLocalSettings();
}

/** The confirm button of the rank grid dialog. */
export const GRID_CONFIRM = 'Start grid';

/** The page with `market` (default: Santiago, which has city coordinates) picked in the header. */
export function renderLocalSeo(market: Market = SANTIAGO) {
  const selection = buildMarketSelectionMock({
    selectedMarketId: market.market_id,
    catalog: { markets: [market] }
  });
  render(
    <MemoryRouter>
      <MARKET_SELECTION_CONTEXT.Provider value={selection}><LocalSeoView /></MARKET_SELECTION_CONTEXT.Provider>
    </MemoryRouter>
  );
  return userEvent.setup();
}

/** Opens `tab` on a freshly rendered page with `market` in the header. */
export async function openTab(tab: string, market: Market = SANTIAGO) {
  const user = renderLocalSeo(market);
  await user.click(screen.getByRole('tab', { name: tab }));
  return user;
}

/** Replaces the text of the field labelled `field` with `text`, then presses the `button` button. */
async function typeThenPress(user: ReturnType<typeof userEvent.setup>, field: string, text: string, button: string) {
  await user.clear(screen.getByLabelText(field));
  await user.type(screen.getByLabelText(field), text);
  await user.click(screen.getByRole('button', { name: button }));
  return user;
}

/** Business search tab: types `query` (and picks `sort`) and presses Search. */
export async function searchBusinessesFor(query: string, sort?: string) {
  const user = renderLocalSeo();
  if (sort !== undefined) await user.selectOptions(screen.getByLabelText('Sort by'), sort);
  return typeThenPress(user, 'Name contains', query, 'Search');
}

/** Searches businesses and opens the first one in the profile tab. */
export async function openFirstBusiness() {
  const user = await searchBusinessesFor('cafe');
  await user.click(await screen.findByRole('button', { name: 'Open' }));
  return user;
}

/** Local results tab: searches `keyword` around the market city. */
export async function searchLocalResults(keyword: string) {
  return typeThenPress(await openTab('Local results'), 'Keyword', keyword, 'Search');
}

/** On the rank grid tab: types the keyword and asks to run (the confirmation opens). */
export async function askForGrid(keyword = 'coffee') {
  return typeThenPress(await openTab('Local rank grid'), 'Keyword', keyword, 'Run grid');
}

/** Asks for the default grid and confirms it. */
export async function runGrid() {
  const user = await askForGrid();
  await user.click(screen.getByRole('button', { name: GRID_CONFIRM }));
  return user;
}

/** The first-column text of every body row of the page's table. */
export function firstColumnTexts(): (string | null)[] {
  return screen.getAllByRole('row').slice(1).map((row) => row.querySelector('td')?.textContent ?? null);
}

/**
 * Presses "Export to Excel" in the card titled `region` and returns what was exported (the specs mock
 * `exportTableToExcel`).
 */
export async function exportTableIn(user: ReturnType<typeof userEvent.setup>, region: string) {
  const card = await screen.findByRole('region', { name: region });
  await user.click(within(card).getByRole('button', { name: EXPORT_EXCEL_LABEL }));
  return vi.mocked(exportTableToExcel).mock.lastCall?.[0];
}
