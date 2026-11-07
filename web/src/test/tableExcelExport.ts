/**
 * The table Excel export as view specs check it, with the exporter spied on (its pure helpers stay real):
 *
 * ```ts
 * vi.mock('<path>/exporters/tableExcel', { spy: true });
 * beforeEach(() => { stubExcelExport(); });
 * ```
 *
 * `lastExcelExport()` reads what the last export wrote.
 */
import { vi } from 'vitest';
import { exportTableToExcel } from '../exporters/tableExcel';

/** Makes `exportTableToExcel` resolve without writing a file. */
export function stubExcelExport(): void {
  vi.mocked(exportTableToExcel).mockResolvedValue();
}

/** The rows, column headers and file naming (`[sheetName, filePrefix, scopeLabel]`) of the last export. */
export function lastExcelExport(): {
  readonly rows: readonly unknown[] | undefined;
  readonly headers: readonly string[] | undefined;
  readonly file: readonly (string | undefined)[];
} {
  const call = vi.mocked(exportTableToExcel).mock.lastCall?.[0];
  return {
    rows: call?.rows,
    headers: call?.columns.map((column) => column.header),
    file: [call?.sheetName, call?.filePrefix, call?.scopeLabel],
  };
}
