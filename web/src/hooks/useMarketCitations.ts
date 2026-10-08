import { useEffect } from 'react';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';
import type {
  Citations, TopUrl
} from '../types';
import {
  apiRequestErrors, isAnalysisPayload, useAnalysisEndpoint
} from './useAnalysisEndpoint';

function isCitationsResponse(data: unknown): data is Citations {
  return isAnalysisPayload(data) && Array.isArray(data.top_urls) && 'provider_stats' in data;
}

const marketCitationsEndpoint = {
  errorContext: 'citations',
  logMessage: '[citations] Error fetching market citations:',
  isValidResponse: isCitationsResponse,
  ...apiRequestErrors('Failed to fetch citations'),
  buildRequest: (marketId: string) => ({
    path: '/citations',
    params: new URLSearchParams({ market_id: marketId }),
  }),
};

export interface MarketCitations {
  readonly citations: TopUrl[];
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The Citations tab's URLs for the header's market: the dashboard's
 * combined list (`combined`, already loaded) when every market is shown,
 * otherwise `GET /citations?market_id=` for the chosen market.
 */
export function useMarketCitations(combined: TopUrl[]): MarketCitations {
  const marketId = useSelectedMarketId();
  const {
    data, loading, error, fetchData
  } = useAnalysisEndpoint(marketCitationsEndpoint);

  useEffect(() => {
    if (marketId !== null) void fetchData(marketId);
  }, [marketId, fetchData]);

  if (marketId === null) return {
    citations: combined,
    loading: false,
    error: null,
  };
  return {
    citations: data?.top_urls ?? [],
    loading,
    error,
  };
}
