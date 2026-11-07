/**
 * The paid Excel export of a DataForSEO-paged table: the rows are asked again from DataForSEO in chunks of
 * `rows_per_request` (the last chunk only the remainder), one request after the other, and each request is
 * billed at most `request_usd` plus `row_usd` a row (DataForSEO bills the rows it returns, so these are maxima).
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

/** The rejection of an export the user cancelled between two requests (named like a fetch abort). */
export class ExportCancelledError extends Error {
  constructor() {
    super('The export was cancelled.');
    this.name = 'AbortError';
  }
}

export type FetchChunk<TRow> = (offset: number, limit: number, signal: AbortSignal) => Promise<readonly TRow[]>;

interface FetchOptions {
  readonly signal: AbortSignal;
  /** Called before each request with the chunk it asks for and its 0-based index. */
  readonly onProgress?: (chunk: ExportChunk, index: number) => void;
}

/**
 * Asks `chunks` one after the other and returns their rows in order. Stops after a chunk that returns fewer rows
 * than it asked (the end of the list), and throws `ExportCancelledError` when `signal` aborts between two requests.
 */
export async function fetchAllChunks<TRow>(
  chunks: readonly ExportChunk[], fetchChunk: FetchChunk<TRow>, {
    signal, onProgress
  }: FetchOptions,
): Promise<TRow[]> {
  const rows: TRow[] = [];
  for (const [index, chunk] of chunks.entries()) {
    if (signal.aborted) throw new ExportCancelledError();
    onProgress?.(chunk, index);
    const chunkRows = await fetchChunk(chunk.offset, chunk.limit, signal);
    rows.push(...chunkRows);
    if (chunkRows.length < chunk.limit) break;
  }
  if (signal.aborted) throw new ExportCancelledError();
  return rows;
}
