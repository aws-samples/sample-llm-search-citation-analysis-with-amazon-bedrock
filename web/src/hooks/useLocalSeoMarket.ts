import { useMemo } from 'react';
import { useMarketSelection } from '../components/Markets/marketSelectionContext';

export interface LocalSeoMarket {
  /** The header market as a request field; "All markets" asks the global market (no field). */
  readonly marketField: { market_id?: string };
  /** The market's city and its coordinates, when the market has them (the default search point). */
  readonly city: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/** The header market, and its city as the default point of every local search. */
export function useLocalSeoMarket(): LocalSeoMarket {
  const {
    selectedMarketId, catalog
  } = useMarketSelection();
  return useMemo(() => {
    const market = catalog.markets.find((candidate) => candidate.market_id === selectedMarketId);
    return {
      marketField: selectedMarketId === null ? {} : { market_id: selectedMarketId },
      city: market?.city ?? null,
      latitude: market?.lat ?? null,
      longitude: market?.lng ?? null,
    };
  }, [catalog.markets, selectedMarketId]);
}
