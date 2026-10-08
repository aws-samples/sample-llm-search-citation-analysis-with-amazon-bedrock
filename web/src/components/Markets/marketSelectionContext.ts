import {
  createContext, useContext
} from 'react';
import type { MarketsController } from '../../hooks/useMarkets';
import type {
  MarketChoice, MarketChoiceOption
} from './marketSelection';

export interface MarketSelectionValue {
  /** The configured markets and the admin's save of a new list. */
  readonly catalog: MarketsController;
  /** The market every scoped view reads (`null` = every market combined). */
  readonly selectedMarketId: MarketChoice;
  readonly selectMarket: (choice: MarketChoice) => void;
  /** The header selector's options; only "All markets (combined)" when no market is configured. */
  readonly options: readonly MarketChoiceOption[];
  /** Some keyword has no market, so "No market" is a meaningful filter. */
  readonly hasUnassignedKeywords: boolean;
}

const NO_CATALOG: MarketsController = {
  markets: [],
  updatedAt: null,
  loading: false,
  loaded: true,
  error: null,
  saveOutcome: { status: 'idle' },
  reload: () => undefined,
  save: () => Promise.resolve(false),
};

/** Outside a provider (isolated views and their specs): no markets, every market combined. */
const NO_MARKETS: MarketSelectionValue = {
  catalog: NO_CATALOG,
  selectedMarketId: null,
  selectMarket: () => undefined,
  options: [],
  hasUnassignedKeywords: true,
};

export const MARKET_SELECTION_CONTEXT = createContext<MarketSelectionValue>(NO_MARKETS);

export function useMarketSelection(): MarketSelectionValue {
  return useContext(MARKET_SELECTION_CONTEXT);
}

/** The market the read endpoints are narrowed to (`null` = every market combined). */
export function useSelectedMarketId(): MarketChoice {
  return useContext(MARKET_SELECTION_CONTEXT).selectedMarketId;
}
