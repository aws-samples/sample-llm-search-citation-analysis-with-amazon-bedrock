/**
 * Reads of the server-paged GET /citations endpoint.
 *
 * The API sorts and filters a scope's distinct URLs and returns one page plus
 * scope-wide totals; the Citations table asks for the page it shows. The
 * full list is exported by the export service (`citations` view).
 */
import { apiGet } from './client';
import type { CitationsPage } from '../types';
import { isRecord } from '../types/domain/keywordDecoders';
import { isScopeCoverage } from '../types/domain/scopeCoverageDecoders';
import type {
  ContentTypeFilter, SortConfig
} from '../exporters/citationParser';

/** The dashboard's first page: enough for its charts and counts, no more. */
export const DASHBOARD_CITATIONS_LIMIT = 25;

/** The largest page the API serves (`limit` max). */
export const MAX_CITATIONS_PAGE = 1000;

/** The citations API answered with something other than a well-formed page. */
export class CitationPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CitationPageError';
  }
}

/** The table's order and filters, as the user set them. */
export interface CitationListQuery {
  readonly sort: SortConfig;
  readonly urlContains: string;
  readonly minCitations: number | '';
  readonly contentType: ContentTypeFilter;
  /** The header's market (`null` = every market combined). */
  readonly marketId: string | null;
}

function isNumberField(record: Record<string, unknown>, name: string): boolean {
  return typeof record[name] === 'number';
}

/**
 * Whether the optional provenance fields are absent or well-formed: `source` (`rollup` before
 * 2.45.0, `snapshot` or `live` since), `as_of`, `stale`, and the 2.45.0 `refreshing` and `coverage`.
 */
const CITATION_SOURCES: ReadonlySet<unknown> = new Set([undefined, 'rollup', 'snapshot', 'live']);

const isOptionalBoolean = (value: unknown): boolean => value === undefined || typeof value === 'boolean';

function hasValidProvenance(record: Record<string, unknown>): boolean {
  return CITATION_SOURCES.has(record.source)
    && (record.as_of === undefined || record.as_of === null || typeof record.as_of === 'string')
    && isOptionalBoolean(record.stale)
    && isOptionalBoolean(record.refreshing)
    && (record.coverage === undefined || isScopeCoverage(record.coverage));
}

/** Whether `value` is a `GET /citations` page with its totals. */
export function isCitationsPage(value: unknown): value is CitationsPage {
  if (!isRecord(value)) return false;
  return hasValidProvenance(value)
    && Array.isArray(value.top_urls)
    && Array.isArray(value.provider_stats)
    && Array.isArray(value.brand_stats)
    && ['total_urls', 'total_citation_count', 'matched_urls'].every((name) => isNumberField(value, name))
    && (value.next_token === null || typeof value.next_token === 'string')
    && typeof value.truncated === 'boolean';
}

/** The query string of `query`: only the parameters that differ from the API defaults. */
export function citationListParams(query: CitationListQuery): Record<string, string> {
  return {
    ...(query.sort.column === 'citations' ? {} : { sort: query.sort.column }),
    ...(query.sort.direction === 'desc' ? {} : { order: query.sort.direction }),
    ...(query.urlContains === '' ? {} : { url_contains: query.urlContains }),
    ...(query.minCitations === '' ? {} : { min_citations: String(query.minCitations) }),
    ...(query.contentType === 'all' ? {} : { content_type: query.contentType }),
    ...(query.marketId === null ? {} : { market_id: query.marketId }),
  };
}

/** One page of `GET /citations` with `params`; rejects with `CitationPageError` when it is malformed. */
export async function fetchCitationsPage(
  params: Readonly<Record<string, string>>,
  signal?: AbortSignal
): Promise<CitationsPage> {
  const payload = await apiGet<unknown>('/citations', {
    signal,
    params: { ...params },
  });
  if (!isCitationsPage(payload)) {
    throw new CitationPageError('Citations API returned an invalid page');
  }
  return payload;
}
