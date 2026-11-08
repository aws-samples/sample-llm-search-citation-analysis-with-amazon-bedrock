import {
  exportTableToExcel, type ExcelTableColumn
} from '../../../exporters/tableExcel';
import type { SeoExportPricing } from '../../../types/api/seo';
import type { DomainTargetRequest } from '../../../types/api/seoDomains';
import { PaidExportButton } from '../../ui/PaidExportButton';
import type { FilterForm } from './domainFilters';
import {
  exportChunkRequest, type PagedExportRequest, type PagedQuery
} from './domainPagedQuery';

/** The Excel export of a paged list: its columns, sheet tab, file name start, name, and the call that pages it. */
export interface PagedExcel<TRow, TSort extends string, TFilters> {
  readonly columns: ReadonlyArray<ExcelTableColumn<TRow>>;
  readonly sheetName: string;
  readonly filePrefix: string;
  /** The list as "Export {tableName} to Excel" names it. */
  readonly tableName: string;
  /** The list's paid lookup, asked for one export chunk. */
  readonly fetchRows: (
    request: PagedExportRequest<TSort, TFilters>, options: { signal: AbortSignal }
  ) => Promise<{ readonly items: readonly TRow[] }>;
}

/** The answer on screen the export reads: its rows, count, target and export pricing. */
export interface ShownAnswer<TRow> {
  readonly target: string;
  readonly items: readonly TRow[];
  readonly total_count: number | null;
  readonly export: SeoExportPricing;
}

interface Props<TRow, TSort extends string, TFilters> {
  readonly excel: PagedExcel<TRow, TSort, TFilters>;
  readonly response: ShownAnswer<TRow>;
  /** What was analyzed, and the query whose answer is on screen. */
  readonly target: DomainTargetRequest;
  readonly query: PagedQuery<TSort>;
  readonly toFilters: (form: FilterForm) => TFilters;
}

/**
 * The right-aligned "Export to Excel" of a paged Domain Overview list: the rows on screen for free, or up to
 * 10,000 rows of the same sorted, filtered list asked again from DataForSEO.
 */
export function DomainPagedExport<TRow, TSort extends string, TFilters>({
  excel, response, target, query, toFilters
}: Props<TRow, TSort, TFilters>) {
  const save = (rows: readonly TRow[]) => exportTableToExcel({
    columns: excel.columns,
    rows,
    sheetName: excel.sheetName,
    filePrefix: excel.filePrefix,
    scopeLabel: response.target,
  });
  return (
    <div className="flex justify-end">
      <PaidExportButton disabled={response.items.length === 0} modal={{
        title: excel.tableName,
        pricing: response.export,
        totalCount: response.total_count,
        onScreenRows: response.items.length,
        fetchChunk: async (offset, limit, signal) => {
          const chunk = await excel.fetchRows(exportChunkRequest(target, query, toFilters, {
            offset,
            limit,
          }), { signal });
          return chunk.items;
        },
        onDownload: save,
        onDownloadScreen: () => save(response.items),
      }} />
    </div>
  );
}
