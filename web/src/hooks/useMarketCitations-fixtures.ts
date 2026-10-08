import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { answerEveryFetch } from '../test/fetchStubs';
import {
  buildMarketSelectionMock, marketSelectionWrapper
} from '../components/Markets/markets-fixtures';
import type {
  Citations, TopUrl
} from '../types';
import { useMarketCitations } from './useMarketCitations';

/** What the dashboard load holds for every market combined. */
export const COMBINED_CITATIONS: TopUrl[] = [{
  url: 'https://www.kayak.com/altiplano',
  citation_count: 4,
}];

/** `GET /citations?market_id=cl-es`. */
export const CHILEAN_CITATIONS: Citations = {
  provider_stats: [],
  brand_stats: [],
  top_urls: [{
    url: 'https://www.despegar.cl/vuelos',
    citation_count: 2,
  }],
};

interface RenderOptions {
  /** The header's market choice (`null` = every market combined). */
  readonly market: string | null;
  readonly status?: number;
}

/** `useMarketCitations(COMBINED_CITATIONS)` under a header with `market` picked; every request answers `CHILEAN_CITATIONS`. */
export function renderMarketCitations({
  market, status = 200
}: RenderOptions) {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
  answerEveryFetch(status === 200 ? CHILEAN_CITATIONS : { error: 'unavailable' }, status);
  const wrapper = marketSelectionWrapper(buildMarketSelectionMock({ selectedMarketId: market }));
  return renderHook(() => useMarketCitations(COMBINED_CITATIONS), { wrapper });
}
