import type {
  ReactElement, ReactNode
} from 'react';
import { render } from '@testing-library/react';
import {
  MemoryRouter, useLocation
} from 'react-router-dom';
import { vi } from 'vitest';
import type { MarketsController } from '../../hooks/useMarkets';
import type {
  Keyword, Market
} from '../../types';
import { marketChoiceOptions } from './marketSelection';
import {
  MARKET_SELECTION_CONTEXT, useMarketSelection, type MarketSelectionValue
} from './marketSelectionContext';
import { MarketSelectionProvider } from './MarketSelectionProvider';
import { MarketSelector } from './MarketSelector';

export function buildMarket(overrides: Partial<Market> = {}): Market {
  return {
    market_id: 'cl-es',
    name: 'Chile (Spanish)',
    country: 'CL',
    country_name: 'Chile',
    language: 'es-CL',
    language_name: 'Spanish',
    currency: 'CLP',
    timezone: 'America/Santiago',
    ...overrides,
  };
}

export const CHILE = buildMarket();

/** Chile with every optional member set. */
export const SANTIAGO = buildMarket({
  city: 'Santiago',
  region: 'RM',
  lat: -33.45,
  lng: -70.66,
  competitors: ['Sky Airline', 'JetSMART'],
  first_party_aliases: ['Altiplano Chile'],
});

export const BRAZIL = buildMarket({
  market_id: 'br-pt',
  name: 'Brazil (Portuguese)',
  country: 'BR',
  country_name: 'Brazil',
  language: 'pt-BR',
  language_name: 'Portuguese',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
});

export function buildMarketsControllerMock(overrides: Partial<MarketsController> = {}): MarketsController {
  return {
    markets: [CHILE, BRAZIL],
    updatedAt: '2026-09-18T09:00:00Z',
    loading: false,
    loaded: true,
    error: null,
    saveOutcome: { status: 'idle' },
    reload: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

interface MarketSelectionOverrides extends Partial<Omit<MarketSelectionValue, 'catalog'>> {readonly catalog?: Partial<MarketsController>;}

export function buildMarketSelectionMock(overrides: MarketSelectionOverrides = {}): MarketSelectionValue {
  const catalog = buildMarketsControllerMock(overrides.catalog);
  const hasUnassignedKeywords = overrides.hasUnassignedKeywords ?? true;
  return {
    selectedMarketId: null,
    selectMarket: vi.fn(),
    options: marketChoiceOptions(catalog.markets, hasUnassignedKeywords),
    ...overrides,
    hasUnassignedKeywords,
    catalog,
  };
}

/** A wrapper providing `value` as the market selection (for `renderHook`). */
export function marketSelectionWrapper(value: MarketSelectionValue) {
  return function MarketSelectionWrapper({ children }: { readonly children: ReactNode }) {
    return <MARKET_SELECTION_CONTEXT.Provider value={value}>{children}</MARKET_SELECTION_CONTEXT.Provider>;
  };
}

/** `ui` rendered with `value` as the market selection. */
export function renderWithMarketSelection(ui: ReactElement, value: MarketSelectionValue = buildMarketSelectionMock()) {
  return render(ui, { wrapper: marketSelectionWrapper(value) });
}

/** Shows what the provider decided: the market every view reads and the URL query. */
function MarketSelectionProbe() {
  const {
    selectedMarketId, selectMarket, options
  } = useMarketSelection();
  const location = useLocation();
  return (
    <>
      <output aria-label="Selected market">{selectedMarketId ?? 'all'}</output>
      <output aria-label="Query">{location.search}</output>
      <output aria-label="Options">{options.map((option) => option.value).join(',')}</output>
      <button type="button" onClick={() => selectMarket('br-pt')}>Pick Brazil</button>
      <button type="button" onClick={() => selectMarket(null)}>Pick every market</button>
    </>
  );
}

/** The provider at `path` over `keywords`, with `MarketSelectionProbe` and the header selector inside. */
export function renderMarketSelectionProvider(path: string, keywords: readonly Keyword[] = []) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MarketSelectionProvider keywords={keywords}>
        <MarketSelector />
        <MarketSelectionProbe />
      </MarketSelectionProvider>
    </MemoryRouter>
  );
}
