/** What an export file holds, for the Exports page: "41,237 rows, 3.2 MB". */

const KB = 1024;
const MB = KB * 1024;

/** `bytes` as "812 B", "14 KB" or "3.2 MB" (one decimal under 10 MB). */
function formatFileSize(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  const megabytes = bytes / MB;
  return megabytes < 10 ? `${megabytes.toFixed(1)} MB` : `${Math.round(megabytes)} MB`;
}

/** "1 row" / "41,237 rows". */
function formatRowCount(rows: number): string {
  return rows === 1 ? '1 row' : `${rows.toLocaleString('en-US')} rows`;
}

/** "41,237 rows, 3.2 MB"; the rows alone while nothing is written yet. */
export function describeExportSize(rows: number, bytes: number): string {
  return bytes === 0 ? formatRowCount(rows) : `${formatRowCount(rows)}, ${formatFileSize(bytes)}`;
}
