import { useCallback } from 'react';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';
import type { MarketChoice } from '../components/Markets/marketSelection';

/**
 * A fetch with the header's market choice bound in as its first argument.
 * The returned function is rebuilt when the market changes, so an effect
 * listing it refetches for the new market.
 */
export function useMarketScopedFetch<TArgs extends readonly unknown[], TResult>(
  fetchData: (marketId: MarketChoice, ...args: TArgs) => TResult
): (...args: TArgs) => TResult {
  const marketId = useSelectedMarketId();
  return useCallback((...args: TArgs) => fetchData(marketId, ...args), [fetchData, marketId]);
}
