/**
 * Excel export of one on-screen table: each column names its header and reads its raw value from a row
 * (numbers stay numbers, so the spreadsheet can sort and sum them).
 *
 * An unknown value (`null`, `undefined`) is an empty cell, never 0; `yesNo` and `spaced` word flags and
 * lists. Text is written as a text cell, which a spreadsheet never runs as a formula, so no `'` guard is
 * needed (the CSV exports needed one). Column widths follow the longest header or cell, between `MIN_WIDTH`
 * and `MAX_WIDTH` characters.
 */
import {
  exportToExcel, scopedExcelFileName
} from './excelGenerator';

type SheetValue = string | number;

export interface ExcelTableColumn<TRow> {
  readonly header: string;
  readonly value: (row: TRow) => SheetValue | null | undefined;
}

const MIN_WIDTH = 8;
const MAX_WIDTH = 60;
/** The longest scope slug a file name keeps. */
const MAX_SLUG = 80;

/** A flag as Yes / No; unknown stays unknown. */
export function yesNo(flag: boolean | null | undefined): string | null {
  if (flag === null || flag === undefined) return null;
  return flag ? 'Yes' : 'No';
}

/** A list as one space-separated cell. */
export function spaced(list: readonly string[] | null | undefined): string {
  return (list ?? []).join(' ');
}

/**
 * `value` rounded to `digits` decimals; unknown stays unknown. DataForSEO sends 32-bit floats
 * (`1.850000023841858`), which a spreadsheet shows in full unless the column is formatted.
 */
export function rounded(value: number | null | undefined, digits: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** One sheet record per row, keyed by the column headers in column order. */
export function excelTableRows<TRow>(
  columns: ReadonlyArray<ExcelTableColumn<TRow>>, rows: readonly TRow[]
): Record<string, SheetValue>[] {
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column.header, column.value(row) ?? ''])));
}

/** Each column's width: its longest header or cell, clamped to `MIN_WIDTH`..`MAX_WIDTH`. */
export function excelColumnWidths(
  headers: readonly string[], data: ReadonlyArray<Record<string, SheetValue>>
): { wch: number }[] {
  return headers.map((header) => {
    const longest = data.reduce((width, record) => Math.max(width, String(record[header] ?? '').length), header.length);
    return { wch: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + 2)) };
  });
}

export interface TableExport<TRow> {
  readonly columns: ReadonlyArray<ExcelTableColumn<TRow>>;
  readonly rows: readonly TRow[];
  /** The sheet tab (cut to Excel's 31 characters). */
  readonly sheetName: string;
  /** The file name start: `<prefix>-<scope slug>-<YYYY-MM-DD>.xlsx`. */
  readonly filePrefix: string;
  /** What the table is about (a domain, a keyword, a site), slugged into the file name. */
  readonly scopeLabel: string;
}

/** Writes `rows` as one sheet and downloads it. */
export async function exportTableToExcel<TRow>({
  columns, rows, sheetName, filePrefix, scopeLabel
}: TableExport<TRow>): Promise<void> {
  const data = excelTableRows(columns, rows);
  await exportToExcel({
    data,
    columns: excelColumnWidths(columns.map((column) => column.header), data),
    sheetName,
    fileName: scopedExcelFileName(filePrefix, scopeLabel, new Date(), MAX_SLUG),
  });
}
