import {
  useCallback, useMemo, useState
} from 'react';
import { useMarketSelection } from '../components/Markets/marketSelectionContext';
import type { Market } from '../types';

export interface PromotionMarket {
  /** The configured markets (empty: no market choice is offered). */
  readonly markets: readonly Market[];
  /** The market every promoted keyword gets (`null` = no market). */
  readonly marketId: string | null;
  readonly choose: (marketId: string | null) => void;
}

/** The chosen id when it is still a configured market; no market otherwise. */
function configuredMarketId(wanted: string | null, markets: readonly Market[]): string | null {
  if (wanted === null) return null;
  return markets.some((market) => market.market_id === wanted) ? wanted : null;
}

/**
 * The market promoted research keywords are created in. Until the user
 * picks one it follows the header: its market when one is picked, no
 * market for "All markets" and "No market".
 */
export function usePromotionMarket(): PromotionMarket {
  const {
    catalog, selectedMarketId
  } = useMarketSelection();
  const [chosen, setChosen] = useState<{ readonly marketId: string | null } | null>(null);
  const { markets } = catalog;
  const marketId = configuredMarketId(chosen === null ? selectedMarketId : chosen.marketId, markets);
  const choose = useCallback((next: string | null) => {
    setChosen({ marketId: next });
  }, []);

  return useMemo(() => ({
    markets,
    marketId,
    choose,
  }), [markets, marketId, choose]);
}
