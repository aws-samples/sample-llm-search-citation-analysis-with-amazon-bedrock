import { useMemo } from 'react';
import type {
  AggregatedBrand, BrandMentionsResponse
} from '../../types';
import {
  fetchBrandSummaryPage, type BrandAppearancesRequest
} from '../../api/brandMentions';
import type { CursorPage } from '../../api/cursorPages';
import {
  useContinuedPages, type ContinuedPages
} from '../../hooks/useContinuedPages';

/**
 * The Brand Mentions table as one growing list: the brands of `data` (the
 * summary's first page) followed by the next 100 each time `loadMore` is
 * called. `request` must be the query `data` answers; while `loading` (a new
 * scope, run, persona or classification is on its way) nothing is appended,
 * and the new summary starts the list again from the top.
 */
export function useBrandSummaryPages(
  data: BrandMentionsResponse | null,
  request: BrandAppearancesRequest | null,
  loading: boolean,
): ContinuedPages<AggregatedBrand> {
  const aggregated = data?.aggregated ?? null;
  const first = useMemo<CursorPage<AggregatedBrand> | null>(() => (aggregated === null ? null : {
    items: aggregated.brands,
    // Older API builds answer one page without a token: the list then ends there.
    nextToken: aggregated.next_token ?? null,
  }), [aggregated]);
  return useContinuedPages(
    first,
    async (nextToken, signal) => {
      // Paused below: without a request there is no page to continue.
      if (request === null) throw new RangeError('No brand mentions query to continue');
      return fetchBrandSummaryPage(request, nextToken, signal);
    },
    (brand) => brand.name.toLowerCase(),
    loading || request === null,
  );
}
