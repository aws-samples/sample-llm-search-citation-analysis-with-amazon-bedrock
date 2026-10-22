/**
 * Shared replacement for `exporters/excelGenerator` in view specs that check
 * what a single-sheet export writes:
 *
 * ```ts
 * vi.mock('../../exporters/excelGenerator', () => import('../../test/excelExportMock'));
 * import { lastExportedColumn } from '../../test/excelExportMock';
 * ```
 *
 * `exportToExcel` becomes a bare `vi.fn()`; the factory's dynamic import and
 * the spec's static import resolve to the same module instance.
 */
import { vi } from 'vitest';

interface ExportedSheet {readonly data: readonly Record<string, unknown>[];}

export const exportToExcel = vi.fn<(sheet: ExportedSheet) => Promise<void>>();

/** The `column` cell of every row the last export wrote; `undefined` before any export. */
export function lastExportedColumn(column: string): unknown[] | undefined {
  return exportToExcel.mock.lastCall?.[0].data.map((row) => row[column]);
}
