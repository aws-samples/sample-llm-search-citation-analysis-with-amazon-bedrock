import type { MarketChoice } from '../components/Markets/marketSelection';
import type {
  Citations, Stats
} from '../types';
import {
  apiRequestErrors, isAnalysisPayload
} from './useAnalysisEndpoint';
import { marketCitationsEndpoint } from './useMarketCitations';
import {
  marketReadRequest, useMarketRead
} from './useMarketRead';

const STAT_TOTALS = ['total_searches', 'total_citations', 'total_crawled', 'unique_keywords'] as const;

function isStatsResponse(data: unknown): data is Stats {
  return isAnalysisPayload(data) && STAT_TOTALS.every((total) => typeof data[total] === 'number');
}

/** `GET /stats?market_id=`: the dashboard totals over one market's keywords. */
const marketStatsEndpoint = {
  errorContext: 'stats',
  logMessage: '[stats] Error fetching market stats:',
  isValidResponse: isStatsResponse,
  ...apiRequestErrors('Failed to fetch stats'),
  buildRequest: marketReadRequest('/stats'),
};

export interface DashboardPanels {
  readonly stats: Stats | null;
  readonly citations: Citations | null;
}

export interface MarketDashboard extends DashboardPanels {
  /** The market the panels cover (`null` = every market combined). */
  readonly marketId: MarketChoice;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The Dashboard's totals and charts for the header's market: `combined`
 * (the dashboard load, no extra request) while every market is shown,
 * otherwise `GET /stats` and `GET /citations` narrowed with `market_id`.
 */
export function useMarketDashboard(combined: DashboardPanels): MarketDashboard {
  const stats = useMarketRead(marketStatsEndpoint);
  const citations = useMarketRead(marketCitationsEndpoint);
  if (stats.marketId === null) return {
    ...combined,
    marketId: null,
    loading: false,
    error: null,
  };
  return {
    stats: stats.data,
    citations: citations.data,
    marketId: stats.marketId,
    loading: stats.loading || citations.loading,
    error: stats.error ?? citations.error,
  };
}
