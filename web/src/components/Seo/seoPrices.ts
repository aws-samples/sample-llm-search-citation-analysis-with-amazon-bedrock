/**
 * DataForSEO list prices (USD upper bounds per call) for the SEO lookups whose API answers no estimate before the
 * call. They mirror `lambda/shared/dataforseo_pricing.py` and `estimated_cost_usd` in `lambda/seo/seo-keywords.py`,
 * read from DataForSEO's per-account price table (`GET /v3/appendix/user_data`) in September 2026, as listed in
 * docs/seo.md › Prices. `lambda/seo/test_seo_prices_contract.py` fails when they drift from the backend.
 */
import type { KeywordResearchMode } from '../../types/api/seo';

/** DataForSEO Labs: per task plus per returned row, doubled with clickstream data. */
const LABS_TASK_USD = 0.012;
const LABS_ROW_USD = 0.00012;

/** Keywords Data Google Ads, live: flat per task (the countries DataForSEO Labs does not serve). */
export const GOOGLE_ADS_RESEARCH_USD = 0.09;

/** The keyword research cache: a repeat of the same request within this many hours is free. */
export const RESEARCH_CACHE_HOURS = 24;

function labsUsd(rows: number, clickstream: boolean): number {
  return (LABS_TASK_USD + rows * LABS_ROW_USD) * (clickstream ? 2 : 1);
}

/** The most one keyword research costs in a DataForSEO Labs country: auto mode is two calls of half the limit. */
export function keywordResearchUsd(request: {
  readonly mode: KeywordResearchMode;
  readonly limit: number;
  readonly clickstream: boolean;
}): number {
  if (request.mode === 'auto') return 2 * labsUsd(Math.ceil(request.limit / 2), request.clickstream);
  return labsUsd(request.limit, request.clickstream);
}
