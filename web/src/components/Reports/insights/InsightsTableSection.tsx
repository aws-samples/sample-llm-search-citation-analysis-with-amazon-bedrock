import type { ReactNode } from 'react';
import type {
  ListPaging, ListRequest
} from '../../../api/scopedListPages';
import { requestParams } from '../../../api/exports';
import { useScopedList } from '../../../hooks/useScopedList';
import { ExportAllButton } from '../../ui/ExportAllButton';
import { ScopedListFooter } from '../../ui/ScopedListFooter';
import type {
  Insight, InsightBlock, ReportInsightsResponse
} from '../../../types/domain/insights';
import {
  gateSection, ReportSection, ReportTable, SectionPlaceholder, type ReportSlice, type ReportTableColumn
} from '../layout';
import { insightSentence } from './insightWording';

/**
 * A section's `/reports/insights` slice: the props every insights block section takes, with the
 * request the answer came from (2.45.0 wave 5: the paged tables load their next pages with it,
 * and Export all exports the scope's facts).
 */
export interface InsightsSectionProps extends ReportSlice<ReportInsightsResponse> {readonly request?: ListRequest | null;}

/** Where a capped facts table keeps its cursor (2.45.0 wave 5: `view=owned_pages`, `view=prompt_engine`). */
export interface InsightsListPaging<Row> {
  readonly paging: ListPaging;
  readonly isItem: (value: unknown) => value is Row;
  /** What the rows are, plural, e.g. "pages". */
  readonly noun: string;
}

interface Props<Row> {
  readonly title: string;
  readonly subtitle: string;
  /** The block whose insights are read out above the table. */
  readonly block: InsightBlock;
  readonly slice: InsightsSectionProps;
  /** The rows the block tables; none shows `emptyMessage`. */
  readonly rows: (response: ReportInsightsResponse) => readonly Row[];
  readonly columns: (response: ReportInsightsResponse) => ReadonlyArray<ReportTableColumn<Row>>;
  readonly rowKey: (row: Row) => string;
  /** Why the table is empty; a function when the reason depends on the response. */
  readonly emptyMessage: string | ((response: ReportInsightsResponse) => string);
  /**
   * A sentence under the table or the empty message: what was left out, or how to measure more.
   * `shown`: how many rows are on screen (a paged table loads more than the first page).
   */
  readonly note?: (response: ReportInsightsResponse, shown: number) => ReactNode;
  /** Shown above the insights: why the facts cover less than the period. */
  readonly notice?: (response: ReportInsightsResponse) => ReactNode;
  /** The table is the first page of a longer list: "Load more" pages through the rest. */
  readonly pages?: InsightsListPaging<Row>;
  /** Under the table: what loads more of the rows' own lists (the caveat reasons). */
  readonly footer?: ReactNode;
}

interface TableProps<Row> {
  readonly response: ReportInsightsResponse;
  readonly rows: readonly Row[];
  readonly columns: ReadonlyArray<ReportTableColumn<Row>>;
  readonly rowKey: (row: Row) => string;
  readonly emptyMessage: string;
  readonly footnote: ReactNode;
}

function FactsTable<Row>({
  rows, columns, rowKey, emptyMessage, footnote
}: TableProps<Row>) {
  return (
    <>
      {rows.length === 0
        ? <SectionPlaceholder variant="empty" message={emptyMessage} />
        : <ReportTable columns={columns} rows={rows} rowKey={rowKey} />}
      {footnote && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{footnote}</p>}
    </>
  );
}

interface PagedTableProps<Row> extends Omit<TableProps<Row>, 'footnote'> {
  readonly request: ListRequest | null;
  readonly pages: InsightsListPaging<Row>;
  readonly note?: (response: ReportInsightsResponse, shown: number) => ReactNode;
}

/** A facts table over its first page, extended page by page over the list's cursor. */
function PagedFactsTable<Row>({
  response, request, pages, note, ...table
}: PagedTableProps<Row>) {
  const list = useScopedList(response, request, pages.paging, pages.isItem);
  const rows = list.items.length === 0 ? table.rows : list.items;
  return (
    <>
      <FactsTable {...table} response={response} rows={rows} footnote={note?.(response, rows.length)} />
      <ScopedListFooter list={list} noun={pages.noun} />
    </>
  );
}

/** The loading and error placeholders of an insights section titled `title`, or its loaded response. */
export function gateInsights(title: string, slice: InsightsSectionProps) {
  return gateSection({
    title,
    loading: slice.loading,
    loadingMessage: 'Loading insights…',
    error: slice.error,
    computing: slice.computing,
    value: slice.data,
  });
}

function InsightLines({ insights }: { readonly insights: readonly Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-gray-800 dark:text-gray-200">
      {insights.map((insight) => <li key={insight.id}>{insightSentence(insight)}</li>)}
    </ul>
  );
}

/**
 * An insights block: its loading and error placeholders, then the sentence of
 * every insight pointing at the block over the table of the facts behind
 * them, or why the table is empty.
 */
export function InsightsTableSection<Row>({
  title, subtitle, block, slice, rows, columns, rowKey, emptyMessage, note, notice, pages, footer
}: Props<Row>) {
  const gate = gateInsights(title, slice);
  if (!gate.ready) return gate.placeholder;

  const response = gate.value;
  const request = slice.request ?? null;
  const table = {
    response,
    rows: rows(response),
    columns: columns(response),
    rowKey,
    emptyMessage: typeof emptyMessage === 'string' ? emptyMessage : emptyMessage(response),
  };
  return (
    <ReportSection title={title} subtitle={subtitle}>
      {request !== null && (
        <div className="mb-2 flex justify-end">
          <ExportAllButton view="report-insights" params={requestParams(request)} />
        </div>
      )}
      {notice?.(response)}
      <InsightLines insights={response.insights.filter((insight) => insight.block === block)} />
      {pages === undefined
        ? <FactsTable {...table} footnote={note?.(response, table.rows.length)} />
        : <PagedFactsTable {...table} request={request} pages={pages} note={note} />}
      {footer}
    </ReportSection>
  );
}
