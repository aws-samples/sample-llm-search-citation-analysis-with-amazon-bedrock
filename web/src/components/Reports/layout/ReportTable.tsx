import type { ReactNode } from 'react';

export interface ReportTableColumn<Row> {
  /**
   * Column heading. Doubles as the React key for the column, so headings
   * must be unique within one table.
   */
  readonly header: string;
  /** Extra classes appended to every body cell in this column (e.g. `font-medium`). */
  readonly cellClassName?: string;
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

/**
 * Print-friendly data table shared by every report section that lists
 * rows. Columns are declared once as typed descriptors so a section only
 * has to say *what* each cell shows, never how the table is styled.
 */
export function ReportTable<Row>({
  columns,
  rows,
  rowKey,
  rowClassName,
  alignTop = false,
}: Props<Row>) {
  const alignClass = alignTop ? 'align-top ' : '';
  return (
    <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            {columns.map((column) => (
              <th
                key={column.header}
                className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                {column.header}
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
                  className={`px-3 py-2 text-gray-700 dark:text-gray-300 ${alignClass}${column.cellClassName ?? ''}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
