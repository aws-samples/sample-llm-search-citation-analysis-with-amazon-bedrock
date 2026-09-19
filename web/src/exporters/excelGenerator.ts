/**
 * Excel export utility with dynamic import to reduce bundle size.
 */

interface ExcelColumn {wch: number;}

interface ExportOptions<T> {
  data: T[];
  columns: ExcelColumn[];
  sheetName: string;
  fileName: string;
}

/** One sheet of a multi-sheet workbook. */
export interface ExcelSheet {
  name: string;
  data: Record<string, unknown>[];
  columns: ExcelColumn[];
}

/** Build a scoped, UTC-dated Excel filename with the existing ASCII slug format. */
export function scopedExcelFileName(
  filePrefix: string,
  scopeLabel: string,
  date: Date,
  maxSlugLength?: number
): string {
  const normalizedSlug = scopeLabel.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
  const truncatedSlug = maxSlugLength === undefined ? normalizedSlug : normalizedSlug.slice(0, maxSlugLength);
  const slug = truncatedSlug || 'keywords';
  return `${filePrefix}-${slug}-${date.toISOString().slice(0, 10)}.xlsx`;
}

/**
 * Export data to Excel file. Dynamically imports xlsx to reduce initial bundle.
 */
export async function exportToExcel<T extends Record<string, unknown>>({
  data,
  columns,
  sheetName,
  fileName,
}: ExportOptions<T>): Promise<void> {
  await exportWorkbook([{
    name: sheetName,
    data,
    columns 
  }], fileName);
}

/**
 * Export several sheets into one workbook (e.g. a KPI table plus its history).
 * Sheet names are truncated to Excel's 31-character limit.
 */
export async function exportWorkbook(sheets: ExcelSheet[], fileName: string): Promise<void> {
  const XLSX = await import('xlsx-js-style') as typeof import('xlsx-js-style');
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.data);
    ws['!cols'] = sheet.columns;
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName);
}
