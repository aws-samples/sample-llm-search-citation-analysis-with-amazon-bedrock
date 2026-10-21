import type { BrandAppearanceRow } from '../../../types';
import { buildAppearanceRow } from '../../../api/brandMentions-fixtures';
import type { ExcelSheet } from '../../../exporters/excelGenerator';
import {
  buildChange, buildDeltas, buildDriver, buildHistory, buildKeywordChange, buildKeywordHistory, buildKeywordRun, buildRun,
  unknownKpis
} from './groupKpiHistory-fixtures';
import { groupKpiReportSheets } from './groupKpiExport';

/** When every fixture workbook was generated. */
export const EXPORTED_AT = new Date('2026-09-28T12:00:00.000Z');

/** The heading of every KPI value column, in report order: the label and its unit. */
export const KPI_VALUE_HEADERS = [
  'Answers',
  'Mentions',
  'Mention rate (%)',
  'Share of voice (%)',
  'Average position',
  'Top-1 share (%)',
  'Top-3 share (%)',
  'Visibility score (0-100)',
  'Citations',
  'Citation rate (%)',
  'Citation share (%)',
  'Net sentiment (-100 to +100)',
  'Engine coverage (%)',
  'Keyword coverage (%)',
];

/** The heading of every KPI change column, in report order: points, positions or plain counts. */
export const KPI_CHANGE_HEADERS = [
  'Answers change',
  'Mentions change',
  'Mention rate change (pts)',
  'Share of voice change (pts)',
  'Average position change (positions)',
  'Top-1 share change (pts)',
  'Top-3 share change (pts)',
  'Visibility score change (pts)',
  'Citations change',
  'Citation rate change (pts)',
  'Citation share change (pts)',
  'Net sentiment change (pts)',
  'Engine coverage change (pts)',
  'Keyword coverage change (pts)',
];

/** A row's KPI value cells, in report order. */
export function kpiValueCells(row: Record<string, unknown>): unknown[] {
  return KPI_VALUE_HEADERS.map((header) => row[header]);
}

/** A row's KPI change cells, in report order. */
export function kpiChangeCells(row: Record<string, unknown>): unknown[] {
  return KPI_CHANGE_HEADERS.map((header) => row[header]);
}

/** Fourteen empty cells: one per KPI, for a row without values or changes. */
export const EMPTY_KPI_CELLS = KPI_VALUE_HEADERS.map(() => '');

/** `/brand-mentions?view=appearances` for the hotel group at RUN_2: one first-party appearance. */
export const BRAND_MENTIONS_AT_RUN: BrandAppearanceRow[] = [buildAppearanceRow()];

class MissingSheetError extends Error {
  constructor(name: string) {
    super(`No sheet named ${name}`);
    this.name = 'MissingSheetError';
  }
}

/** The rows of the sheet called `name`. */
export function sheetRows(sheets: readonly ExcelSheet[], name: string): Record<string, unknown>[] {
  const found = sheets.find((entry) => entry.name === name);
  if (found === undefined) throw new MissingSheetError(name);
  return found.data;
}

/** The workbook of `buildHistory()` for its second (compared) group run, with `mentions` as the raw-data sheet. */
export function selectedRunSheets(mentions: BrandAppearanceRow[] | null = BRAND_MENTIONS_AT_RUN): ExcelSheet[] {
  const history = buildHistory();
  return groupKpiReportSheets(history, 'Hotel Sol', history.runs[1], mentions, EXPORTED_AT);
}

/** The Summary rows of `buildHistory()` for the run at `index`, as [Metric, Value, Change, Trend]. */
export function summaryCells(index: number, history = buildHistory()): unknown[][] {
  const sheets = groupKpiReportSheets(history, 'Hotel Sol', history.runs[index], null, EXPORTED_AT);
  return sheetRows(sheets, 'Summary').map((row) => [row.Metric, row.Value, row.Change, row.Trend]);
}

/** A workbook write that failed. */
export class WorkbookWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookWriteError';
  }
}

/**
 * A workbook where every optional value is unknown: a group run with only
 * unknown KPIs whose change has only unknown deltas and a driver whose
 * mention did not change, and a keyword run that gained the brand with only
 * unknown KPIs and changes.
 */
export function unknownValueSheets(): ExcelSheet[] {
  const base = buildHistory();
  const run = buildRun({
    kpis: unknownKpis(),
    change: buildChange({
      deltas: buildDeltas(),
      drivers: [buildDriver({
        mention: null,
        deltas: buildDeltas(),
      })],
    }),
  });
  const history = {
    ...base,
    runs: [run],
    keywords: [buildKeywordHistory('k', [buildKeywordRun({
      kpis: unknownKpis(),
      change: buildKeywordChange('gained'),
    })])],
  };
  return groupKpiReportSheets(history, 'Hotel Sol', run, null, EXPORTED_AT);
}
