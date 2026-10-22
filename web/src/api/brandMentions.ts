/**
 * Complete reads of `/brand-mentions?view=appearances`: every appearance of
 * a scope's selected run, one bounded page at a time.
 *
 * The summary the Brands view shows previews only a few appearances per
 * brand; the Excel exports (the Brands view and the per-hotel workbook) and
 * the brand drill-down follow `next_token` until the server reports the last
 * page, so no single response approaches the Lambda payload cap.
 */
import { apiGet } from './client';
import {
  collectCursorPages, withNextToken, type CursorPage
} from './cursorPages';
import type {
  BrandAppearanceRow, ReportScope
} from '../types';
import { reportScopeParams } from '../components/ui/reportScope';
import { isBrandAppearancesPage } from './brandMentionsDecoders';

export class InvalidBrandMentionsResponseError extends TypeError {
  constructor(message = 'Brand mentions API returned an invalid response') {
    super(message);
    this.name = 'InvalidBrandMentionsResponseError';
  }
}

/** The server-side filters of `/brand-mentions`, keyed by query parameter; `null` leaves one out. */
export type BrandMentionsFilters = Record<'classification' | 'query_prompt_id' | 'timestamp', string | null>;

/** What to read: the scope, the header's market (`null` = every market), the filters and optionally one brand. */
export interface BrandAppearancesRequest {
  readonly scope: ReportScope;
  readonly marketId: string | null;
  readonly filters: Partial<BrandMentionsFilters>;
  readonly brand?: string;
}

/** Rows per page; the server also cuts a page at its byte budget. */
const APPEARANCES_PAGE_LIMIT = '2000';

/** The query parameters of one `/brand-mentions` request: scope, market and every non-null filter. */
export function brandMentionsParams(
  scope: ReportScope, marketId: string | null, filters: Partial<BrandMentionsFilters>
): Record<string, string> {
  const params = reportScopeParams(scope, marketId);
  for (const [name, value] of Object.entries(filters)) {
    if (value) params[name] = value;
  }
  return params;
}

async function fetchAppearancesPage(
  request: BrandAppearancesRequest, nextToken: string | null
): Promise<CursorPage<BrandAppearanceRow>> {
  const params = {
    ...brandMentionsParams(request.scope, request.marketId, request.filters),
    ...(request.brand === undefined ? {} : { brand: request.brand }),
    view: 'appearances',
    limit: APPEARANCES_PAGE_LIMIT,
  };
  const payload = await apiGet<unknown>('/brand-mentions', { params: withNextToken(params, nextToken) });
  if (!isBrandAppearancesPage(payload)) throw new InvalidBrandMentionsResponseError();
  return {
    items: payload.appearances,
    nextToken: payload.next_token,
  };
}

/**
 * Every appearance the request selects, in the server's order (brands by
 * aggregate score, then read order). Rejects, without a partial list, when a
 * page fails, is malformed, or repeats a token.
 */
export async function fetchBrandAppearances(request: BrandAppearancesRequest): Promise<BrandAppearanceRow[]> {
  return collectCursorPages(
    async (nextToken: string | null) => fetchAppearancesPage(request, nextToken),
    () => new InvalidBrandMentionsResponseError('Brand mentions API repeated a continuation token')
  );
}
