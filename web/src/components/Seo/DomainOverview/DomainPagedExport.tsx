import type { SeoExportPricing } from '../../../types/api/seo';
import type { DomainTargetRequest } from '../../../types/api/seoDomains';
import { PaidExportButton } from '../../ui/PaidExportButton';
import type { FilterForm } from './domainFilters';
import {
  exportListParams, type PagedQuery
} from './domainPagedQuery';

/** The server export of a paged list (view `seo-domain`): its `table` param and its name in "Export {tableName}". */
export interface PagedExport {
  readonly table: 'keywords' | 'pages';
  readonly tableName: string;
}

/** The answer on screen the export dialog reads: its rows, count and export pricing. */
export interface ShownAnswer<TRow> {
  readonly items: readonly TRow[];
  readonly total_count: number | null;
  readonly export: SeoExportPricing;
}

interface Props<TRow, TSort extends string, TFilters> {
  readonly exported: PagedExport;
  readonly response: ShownAnswer<TRow>;
  /** What was analyzed, and the query whose answer is on screen. */
  readonly target: DomainTargetRequest;
  readonly query: PagedQuery<TSort>;
  readonly toFilters: (form: FilterForm) => TFilters;
}

/**
 * The right-aligned "Export" of a paged Domain Overview list: a server export of the page on screen for free, or of
 * up to 10,000 rows of the same sorted, filtered list asked again from DataForSEO at the price the user confirmed.
 */
export function DomainPagedExport<TRow, TSort extends string, TFilters>({
  exported, response, target, query, toFilters
}: Props<TRow, TSort, TFilters>) {
  return (
    <div className="flex justify-end">
      <PaidExportButton disabled={response.items.length === 0} modal={{
        title: exported.tableName,
        pricing: response.export,
        totalCount: response.total_count,
        onScreenRows: response.items.length,
        view: 'seo-domain',
        params: {
          table: exported.table,
          ...exportListParams(target, query, toFilters),
        },
        screenPage: {
          page: query.page,
          page_size: query.pageSize,
        },
      }} />
    </div>
  );
}
