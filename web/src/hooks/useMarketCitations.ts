import type {
  Citations, TopUrl
} from '../types';
import {
  apiRequestErrors, isAnalysisPayload
} from './useAnalysisEndpoint';
import {
  marketReadRequest, useMarketRead
} from './useMarketRead';

function isCitationsResponse(data: unknown): data is Citations {
  return isAnalysisPayload(data) && Array.isArray(data.top_urls) && 'provider_stats' in data;
}

/** `GET /citations?market_id=`: one market's provider, brand and URL citation counts. */
export const marketCitationsEndpoint = {
  errorContext: 'citations',
  logMessage: '[citations] Error fetching market citations:',
  isValidResponse: isCitationsResponse,
  ...apiRequestErrors('Failed to fetch citations'),
  buildRequest: marketReadRequest('/citations'),
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
  const read = useMarketRead(marketCitationsEndpoint);
  return {
    citations: read.marketId === null ? combined : read.data?.top_urls ?? [],
    loading: read.loading,
    error: read.error,
  };
}
