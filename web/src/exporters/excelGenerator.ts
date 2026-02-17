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

/**
 * Export data to Excel file. Dynamically imports xlsx to reduce initial bundle.
 */
export async function exportToExcel<T extends Record<string, unknown>>({
  data,
  columns,
  sheetName,
  fileName,
}: ExportOptions<T>): Promise<void> {
  const XLSX = await import('xlsx-js-style') as typeof import('xlsx-js-style');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = columns;
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}
