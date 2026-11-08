import type { ReactNode } from 'react';
import type {
  BrandLeaderboardRow, SourceRow, VisibilityResponse
} from '../../../types';
import type { ExportView } from '../../../types/domain/exports';
import type { ListRequest } from '../../../api/scopedListPages';
import { requestParams } from '../../../api/exports';
import {
  isBrandLeaderboardRow, isSourceRow, VISIBILITY_BRANDS_PAGING, VISIBILITY_SOURCES_PAGING
} from '../../../api/scopedListPagings';
import { useScopedList } from '../../../hooks/useScopedList';
import { ExportAllButton } from '../../ui/ExportAllButton';
import { ScopedListFooter } from '../../ui/ScopedListFooter';
import {
  ReportTable, type ReportTableColumn
} from '../layout/ReportTable';
import { brandRowKey } from './brandColumns';
import type { ScopeReportData } from './useScopeReportData';

interface ExportRowProps {
  readonly view: ExportView;
  /** The request the section's data came from; no button until it is made (a fixture without one). */
  readonly request: ListRequest | null | undefined;
}

/** Export all of a report section's data (2.45.0 wave 5), right-aligned above its table. Screen only. */
export function SectionExport({
  view, request
}: ExportRowProps) {
  if (request === null || request === undefined) return null;
  return (
    <div className="mb-2 flex justify-end">
      <ExportAllButton view={view} params={requestParams(request)} />
    </div>
  );
}

/** The anchor of a scope report's full brand table, for the "See all brands" of its charts. */
export const SCOPE_BRANDS_ANCHOR = 'scope-report-brands';

/** The anchor of a scope report's full domain table, for the "See all domains" of its chart. */
export const SCOPE_SOURCES_ANCHOR = 'scope-report-sources';

interface BrandTableProps {
  readonly report: ScopeReportData;
  readonly visibility: VisibilityResponse;
  readonly columns: ReadonlyArray<ReportTableColumn<BrandLeaderboardRow>>;
  readonly rowClassName?: (row: BrandLeaderboardRow) => string;
  /** Shown under the table, above its "Load more brands". */
  readonly footer?: ReactNode;
}

/**
 * Every brand of the scope's latest runs (2.45.0 wave 5): the answer's first page, then "Load more
 * brands" over `view=brands`, with Export all of the whole leaderboard.
 */
export function ScopeBrandTable({
  report, visibility, columns, rowClassName, footer
}: BrandTableProps) {
  const request = report.visibilityRequest ?? null;
  const list = useScopedList(visibility, request, VISIBILITY_BRANDS_PAGING, isBrandLeaderboardRow);
  const rows = list.items.length === 0 ? visibility.brands : list.items;
  return (
    <div id={SCOPE_BRANDS_ANCHOR}>
      <SectionExport view="brand-leaderboard" request={request} />
      <ReportTable columns={columns} rows={rows} rowKey={brandRowKey} rowClassName={rowClassName} />
      {footer}
      <ScopedListFooter list={list} noun="brands" />
    </div>
  );
}

interface SourceTableProps {
  readonly report: ScopeReportData;
  readonly visibility: VisibilityResponse;
  readonly columns: ReadonlyArray<ReportTableColumn<SourceRow>>;
  readonly rowKey: (row: SourceRow) => string;
}

/**
 * Every domain the scope's latest runs cite (2.45.0 wave 5): the answer's first page, then "Load
 * more domains" over `view=sources`, with Export all of the whole source table.
 */
export function ScopeSourceTable({
  report, visibility, columns, rowKey
}: SourceTableProps) {
  const request = report.visibilityRequest ?? null;
  const list = useScopedList(visibility, request, VISIBILITY_SOURCES_PAGING, isSourceRow);
  const rows = list.items.length === 0 ? visibility.sources : list.items;
  return (
    <div id={SCOPE_SOURCES_ANCHOR}>
      <SectionExport view="sources" request={request} />
      <ReportTable columns={columns} rows={rows} rowKey={rowKey} />
      <ScopedListFooter list={list} noun="domains" />
    </div>
  );
}
