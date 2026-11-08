/**
 * Reads of `/brand-mentions?view=appearances`: a scope's appearances in the selected run, one
 * bounded page at a time.
 *
 * The summary the Brands view shows previews only a few appearances per brand; the brand
 * drill-down follows `next_token` with "Load more", and Export all (`brand-appearances`) writes
 * every appearance on the server.
 */
import { apiGet } from './client';
import type {
  BrandAppearancesPage, ReportScope
} from '../types';
import { reportScopeParams } from '../components/ui/reportScope';
import { isBrandAppearancesPage } from './brandMentionsDecoders';
import type {
  ListPaging, ListRequest
} from './scopedListPages';

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

/** The export params of a Brands view or brand drill-down: its scope, market, filters and brand. */
export function brandMentionsExportParams(request: BrandAppearancesRequest): Record<string, string> {
  return {
    ...brandMentionsParams(request.scope, request.marketId, request.filters),
    ...(request.brand === undefined ? {} : { brand: request.brand }),
  };
}

/** The export params of the Brands view's brand list: its scope, market and filters (the summary takes no brand). */
export function brandMentionSummaryExportParams(request: BrandAppearancesRequest): Record<string, string> {
  return brandMentionsParams(request.scope, request.marketId, request.filters);
}

/** The summary's brand list (2.45.0 wave 5: past its first 100); next pages from `view=brands`. */
export const BRAND_MENTIONS_BRANDS_PAGING: ListPaging = {
  list: 'aggregated.brands',
  token: 'aggregated.brands_next_token',
  total: 'aggregated.brands_total',
  view: 'brands',
};

function appearancesParams(request: BrandAppearancesRequest): Record<string, string> {
  return {
    ...brandMentionsExportParams(request),
    view: 'appearances',
    limit: APPEARANCES_PAGE_LIMIT,
  };
}

/** Where a `view=appearances` page keeps its rows, cursor and total: the page is the list. */
export const APPEARANCES_PAGING: ListPaging = {
  list: 'appearances',
  token: 'next_token',
  total: 'total_appearances',
  view: null,
};

/** The GET of the request's appearance pages, as `useScopedList` repeats it with each cursor. */
export function appearancesListRequest(request: BrandAppearancesRequest): ListRequest {
  return {
    path: '/brand-mentions',
    params: new URLSearchParams(appearancesParams(request)),
  };
}

/** The first `view=appearances` page of the request (a brand drill-down extends it with "Load more"). */
export async function fetchFirstAppearancesPage(request: BrandAppearancesRequest, signal?: AbortSignal): Promise<BrandAppearancesPage> {
  const payload = await apiGet<unknown>('/brand-mentions', {
    params: appearancesParams(request),
    signal,
  });
  if (!isBrandAppearancesPage(payload)) throw new InvalidBrandMentionsResponseError();
  return payload;
}
