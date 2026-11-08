/**
 * The data table of the dashboard's dense lists (SEO keywords, pages,
 * backlinks): a bordered card that scrolls sideways on narrow screens, a
 * grey header that stays in view while a long table scrolls, sort buttons
 * with `aria-sort`, right-aligned tabular numbers and a row hover.
 *
 * Sorting is the caller's: a click on a sortable heading calls `onSort` with
 * its key (a server-side sort re-asks the page; a client-side one re-orders).
 */
import {
  Fragment, type ReactNode
} from 'react';
import { InfoTooltip } from './InfoTooltip';
import { StrokeIcon } from './StrokeIcon';
import {
  CHEVRON_DOWN_PATHS, CHEVRON_UP_PATHS
} from './iconPaths';

export interface DataColumn<TRow, TKey extends string = string> {
  readonly id: string;
  readonly header: string;
  /** Shown in an "i" tooltip beside the heading. */
  readonly help?: string;
  /** The key a click on the heading sorts by; none = not sortable. */
  readonly sortKey?: TKey;
  /** Right-aligned, tabular figures. */
  readonly numeric?: boolean;
  readonly render: (row: TRow) => ReactNode;
}

export interface DataTableSort<TKey extends string = string> {
  readonly key: TKey;
  readonly order: 'asc' | 'desc';
}

/** Header and body cell classes, for rows a caller draws itself (expanded child rows). */
export const DATA_TABLE_HEADER_CELL = 'px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap';
export const DATA_TABLE_CELL = 'px-4 py-2.5 text-sm text-gray-700 align-middle';

/** Tables longer than this scroll inside the card, under a header that stays in view. */
const STICKY_FROM_ROWS = 15;

const ARIA_SORT = {
  asc: 'ascending',
  desc: 'descending',
} as const;

/** The text alignment of a column's cells. */
export function alignClass(column: { readonly numeric?: boolean }): string {
  return column.numeric === true ? 'text-right tabular-nums' : 'text-left';
}

function SortGlyph({
  active, order
}: {
  readonly active: boolean;
  readonly order: 'asc' | 'desc';
}) {
  const paths = active && order === 'asc' ? CHEVRON_UP_PATHS : CHEVRON_DOWN_PATHS;
  return <StrokeIcon className={`w-3 h-3 shrink-0 ${active ? 'text-gray-900' : 'text-gray-300'}`} paths={paths} strokeWidth={2} aria-hidden="true" />;
}

function HeaderCell<TRow, TKey extends string>({
  column, sort, onSort
}: {
  readonly column: DataColumn<TRow, TKey>;
  readonly sort: DataTableSort<TKey> | undefined;
  readonly onSort: ((key: TKey) => void) | undefined;
}) {
  const { sortKey } = column;
  const active = sortKey !== undefined && sort?.key === sortKey;
  const order = sort?.order ?? 'desc';
  const justify = column.numeric === true ? 'justify-end' : 'justify-start';
  return (
    <th scope="col" aria-sort={active ? ARIA_SORT[order] : undefined} className={`${DATA_TABLE_HEADER_CELL} ${alignClass(column)}`}>
      <span className={`flex items-center gap-1 ${justify}`}>
        {sortKey === undefined || onSort === undefined
          ? column.header
          : (
            <button type="button" onClick={() => onSort(sortKey)}
              className={`inline-flex items-center gap-1 uppercase tracking-wider rounded hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${active ? 'text-gray-900' : ''}`}>
              {column.header}
              <SortGlyph active={active} order={order} />
            </button>
          )}
        {column.help !== undefined && <InfoTooltip label={column.header} text={column.help} />}
      </span>
    </th>
  );
}

interface LeadingColumn<TRow> {
  /** Screen-reader name of the column (e.g. "Expand"). */
  readonly label: string;
  readonly render: (row: TRow) => ReactNode;
}

interface DataTableProps<TRow, TKey extends string> {
  readonly rows: readonly TRow[];
  readonly columns: ReadonlyArray<DataColumn<TRow, TKey>>;
  readonly rowKey: (row: TRow, index: number) => string;
  /** Names the table for assistive technology (rendered as a hidden caption). */
  readonly caption: string;
  readonly sort?: DataTableSort<TKey>;
  readonly onSort?: (key: TKey) => void;
  /** A narrow first column without a heading (expand toggles). */
  readonly leading?: LeadingColumn<TRow>;
  /** Rows drawn under a row (its expanded children); use `DATA_TABLE_CELL` for their cells. */
  readonly renderAfter?: (row: TRow) => ReactNode;
  /** Shown in place of the rows when there are none. */
  readonly emptyText?: string;
}

/** A sortable data table in a bordered, scrollable card (see the module comment). */
export function DataTable<TRow, TKey extends string = string>({
  rows, columns, rowKey, caption, sort, onSort, leading, renderAfter, emptyText = 'No rows match.'
}: DataTableProps<TRow, TKey>) {
  const span = columns.length + (leading === undefined ? 0 : 1);
  const scroll = rows.length > STICKY_FROM_ROWS ? 'max-h-[70vh] overflow-auto' : 'overflow-x-auto';
  return (
    <div className={`${scroll} rounded-lg border border-gray-200 bg-white`}>
      <table className="min-w-full divide-y divide-gray-200">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-gray-50">
          <tr>
            {leading !== undefined && <th scope="col" className={`${DATA_TABLE_HEADER_CELL} w-10`}><span className="sr-only">{leading.label}</span></th>}
            {columns.map((column) => <HeaderCell key={column.id} column={column} sort={sort} onSort={onSort} />)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 && (
            <tr><td colSpan={span} className={`${DATA_TABLE_CELL} py-8 text-center text-gray-500`}>{emptyText}</td></tr>
          )}
          {rows.map((row, index) => (
            <Fragment key={rowKey(row, index)}>
              <tr className="transition-colors hover:bg-gray-50">
                {leading !== undefined && <td className={`${DATA_TABLE_CELL} w-10`}>{leading.render(row)}</td>}
                {columns.map((column) => (
                  <td key={column.id} className={`${DATA_TABLE_CELL} ${alignClass(column)}`}>{column.render(row)}</td>
                ))}
              </tr>
              {renderAfter?.(row)}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
