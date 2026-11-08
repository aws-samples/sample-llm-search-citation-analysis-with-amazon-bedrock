/**
 * The price of a paid server export of a DataForSEO-paged table: the export service asks the rows again from
 * DataForSEO in chunks of `rows_per_request` (the last chunk only the remainder), and each request is billed at
 * most `request_usd` plus `row_usd` a row (DataForSEO bills the rows it returns, so these are maxima).
 */
import type { SeoExportPricing } from '../types/api/seo';

/** One export request: `limit` rows from `offset` (0-based). */
export interface ExportChunk {
  readonly offset: number;
  readonly limit: number;
}

export interface ExportPlan {
  readonly chunks: readonly ExportChunk[];
  readonly requests: number;
  /** The most the export can cost, unrounded. */
  readonly priceUsd: number;
}

/** The chunks and the price ceiling of exporting the first `rows` rows. */
export function exportPlan(rows: number, pricing: SeoExportPricing): ExportPlan {
  const perRequest = pricing.rows_per_request;
  const requests = Math.ceil(rows / perRequest);
  const chunks = Array.from({ length: requests }, (_unused, index) => ({
    offset: index * perRequest,
    limit: Math.min(perRequest, rows - index * perRequest),
  }));
  return {
    chunks,
    requests,
    priceUsd: requests * pricing.request_usd + rows * pricing.row_usd,
  };
}

/** Digits kept before rounding up, so float noise (`0.06` read as `6.000000000000001` cents) adds no cent. */
const CENT_PRECISION = 1e6;

/** `0.132` → "up to $0.14": rounded up to the cent, and never under a cent once above zero. */
export function priceText(usd: number): string {
  const cents = Math.ceil(Math.round(usd * 100 * CENT_PRECISION) / CENT_PRECISION);
  const shown = usd > 0 ? Math.max(1, cents) : 0;
  return `up to $${(shown / 100).toFixed(2)}`;
}

/** The row count typed, as a whole number from 1 to `maxRows`; `null` when it is not a number or under 1. */
export function clampRows(input: number, maxRows: number): number | null {
  if (!Number.isFinite(input) || input < 1) return null;
  return Math.min(Math.floor(input), maxRows);
}
