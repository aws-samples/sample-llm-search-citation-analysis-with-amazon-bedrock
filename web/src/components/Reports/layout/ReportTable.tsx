import type { ReactNode } from 'react';
import { InfoTooltip } from '../../ui/InfoTooltip';
import { useHorizontalOverflow } from './useHorizontalOverflow';

export interface ReportTableColumn<Row> {
  /**
   * Column heading. Doubles as the React key for the column, so headings
   * must be unique within one table.
   */
  readonly header: string;
  /** What the column measures, shown in an "i" tooltip next to the heading. */
  readonly info?: string;
  /** Extra classes appended to every body cell in this column (e.g. `font-medium`). */
  readonly cellClassName?: string;
  /** A column of figures: heading and cells right-aligned, digits of equal width so they line up. */
  readonly numeric?: boolean;
  readonly render: (row: Row) => ReactNode;
}

interface Props<Row> {
  readonly columns: ReadonlyArray<ReportTableColumn<Row>>;
  readonly rows: ReadonlyArray<Row>;
  readonly rowKey: (row: Row) => string;
  /**
   * Optional per-row tint (first-party highlight, mover highlight, ...).
   * Return an empty string for rows that should not be tinted.
   */
  readonly rowClassName?: (row: Row) => string;
  /** Top-align cell content when some cells span several lines. */
  readonly alignTop?: boolean;
}

function alignClass({ numeric }: { readonly numeric?: boolean }): string {
  return numeric === true ? 'text-right tabular-nums' : 'text-left';
}

/**
 * Print-friendly data table shared by every report section that lists
 * rows. Columns are declared once as typed descriptors so a section only
 * has to say *what* each cell shows, never how the table is styled.
 *
 * The table sits in a white card. When it is wider than the card it scrolls
 * sideways: the scroll box takes keyboard focus and a fade on the right edge
 * says more columns follow.
 */
export function ReportTable<Row>({
  columns,
  rows,
  rowKey,
  rowClassName,
  alignTop = false,
}: Props<Row>) {
  const verticalClass = alignTop ? 'align-top ' : '';
  const {
    ref, scrolls, moreRight
  } = useHorizontalOverflow<HTMLDivElement>();
  return (
    <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div
        ref={ref}
        className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900"
        tabIndex={scrolls ? 0 : undefined}
      >
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/40">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  scope="col"
                  className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 ${alignClass(column)}`}
                >
                  {column.header}
                  {column.info !== undefined && <InfoTooltip label={column.header} text={column.info} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {rows.map((row) => (
              <tr key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={`px-3 py-2 text-gray-700 dark:text-gray-300 ${verticalClass}${alignClass(column)} ${column.cellClassName ?? ''}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {moreRight && (
        <div aria-hidden="true" className="print-hidden pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent dark:from-gray-800" />
      )}
    </div>
  );
}
