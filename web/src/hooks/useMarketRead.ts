import { useEffect } from 'react';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';
import type { MarketChoice } from '../components/Markets/marketSelection';
import {
  useAnalysisEndpoint, type AnalysisEndpointConfig
} from './useAnalysisEndpoint';

export interface MarketRead<TResponse> {
  /** The header's market (`null` = every market combined: nothing is requested). */
  readonly marketId: MarketChoice;
  /** The picked market's answer; `null` until it arrives or when every market is shown. */
  readonly data: TResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * One read endpoint narrowed to the header's market: requested again
 * whenever the market changes, never while every market is combined (the
 * caller already holds the combined answer from the dashboard load).
 * Pass a module-level `endpoint` so the request keeps a stable identity.
 */
export function useMarketRead<TResponse>(endpoint: AnalysisEndpointConfig<[string], TResponse>): MarketRead<TResponse> {
  const marketId = useSelectedMarketId();
  const {
    data, loading, error, fetchData
  } = useAnalysisEndpoint(endpoint);

  useEffect(() => {
    if (marketId !== null) void fetchData(marketId);
  }, [marketId, fetchData]);

  return {
    marketId,
    data: marketId === null ? null : data,
    loading: marketId !== null && loading,
    error: marketId === null ? null : error,
  };
}

/** The request of a market read: `path?market_id=<id>`. */
export function marketReadRequest(path: string) {
  return (marketId: string) => ({
    path,
    params: new URLSearchParams({ market_id: marketId }),
  });
}
