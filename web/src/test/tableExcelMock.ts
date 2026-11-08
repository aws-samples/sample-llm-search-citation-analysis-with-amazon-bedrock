/**
 * Stand-in for `exporters/tableExcel` in the local SEO and SEO vs GEO specs: the real column helpers, and
 * `exportTableToExcel` as a spy so a spec reads what a button exported instead of writing a file.
 *
 * ```ts
 * vi.mock('../exporters/tableExcel', () => import('./tableExcel-fixtures'));
 * ```
 */
import { vi } from 'vitest';
import type * as tableExcel from '../exporters/tableExcel';

const actual = await vi.importActual<typeof tableExcel>('../exporters/tableExcel');

export const {
  excelColumnWidths, excelTableRows, spaced, yesNo
} = actual;

export const exportTableToExcel = vi.fn<typeof tableExcel.exportTableToExcel>();
