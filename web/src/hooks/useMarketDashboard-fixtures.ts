import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { answerFetchByPath } from '../test/fetchStubs';
import {
  buildMarketSelectionMock, marketSelectionWrapper
} from '../components/Markets/markets-fixtures';
import type {
  Citations, Stats
} from '../types';
import type { DashboardPanels } from './useMarketDashboard';
import { useMarketDashboard } from './useMarketDashboard';

/** The dashboard load: every market combined. */
export const COMBINED_PANELS: DashboardPanels = {
  stats: {
    total_searches: 40,
    total_citations: 120,
    total_crawled: 90,
    unique_keywords: 10,
  },
  citations: {
    provider_stats: [{
      provider: 'openai',
      citation_count: 120,
    }],
    brand_stats: [{
      brand: 'Altiplano Air',
      mention_count: 30,
    }],
    top_urls: [],
  },
};

/** `GET /stats?market_id=cl-es`. */
export const CHILEAN_STATS: Stats = {
  total_searches: 8,
  total_citations: 21,
  total_crawled: 15,
  unique_keywords: 2,
};

/** `GET /citations?market_id=cl-es`. */
export const CHILEAN_PANEL_CITATIONS: Citations = {
  provider_stats: [{
    provider: 'openai',
    citation_count: 21,
  }],
  brand_stats: [{
    brand: 'Altiplano Air',
    mention_count: 6,
  }],
  top_urls: [{
    url: 'https://www.despegar.cl/vuelos',
    citation_count: 2,
  }],
};

/** Both market endpoints answering the Chilean figures. */
export function answerChileanPanels(statsBody: unknown = CHILEAN_STATS): void {
  answerFetchByPath({
    '/stats': statsBody,
    '/citations': CHILEAN_PANEL_CITATIONS,
  });
}

/** `useMarketDashboard(COMBINED_PANELS)` under a header with `market` picked (`null` = every market). */
export function renderMarketDashboard(market: string | null, statsBody?: unknown) {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
  answerChileanPanels(statsBody);
  const wrapper = marketSelectionWrapper(buildMarketSelectionMock({ selectedMarketId: market }));
  return renderHook(() => useMarketDashboard(COMBINED_PANELS), { wrapper });
}
