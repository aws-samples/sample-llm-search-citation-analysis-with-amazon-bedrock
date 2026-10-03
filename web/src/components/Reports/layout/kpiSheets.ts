/**
 * The pieces the KPI Excel exports share (the group report's and the
 * Visibility tab's): KPI headings with their unit, a row of KPI cells, the
 * definitions sheet and column widths. An unknown value is an empty cell,
 * never `null` or a dash, so a spreadsheet can still compute with the column.
 */
import type { ExcelSheet } from '../../../exporters/excelGenerator';
import type {
  BrandKpis, KpiDeltas, KpiTrend
} from '../../../types/domain/groupKpiHistory';
import {
  KPI_SPECS, type KpiDefinition, type KpiId, type KpiSpec, type KpiUnit
} from '../../../constants/kpiDefinitions';

export type Cell = string | number;

/** The unit a KPI value heading ends with; counts and positions need none. */
const VALUE_HEADING_UNIT: Readonly<Record<KpiUnit, string>> = {
  percent: ' (%)',
  score: ' (0-100)',
  net: ' (-100 to +100)',
  count: '',
  position: '',
};

/** The column heading of a KPI value: its label and unit, e.g. "Mention rate (%)". */
export function kpiValueHeader({
  label, unit
}: KpiSpec): string {
  return `${label}${VALUE_HEADING_UNIT[unit]}`;
}

/** Every KPI as one cell each; all empty when the KPIs are unknown. */
export function kpiCells(kpis: BrandKpis | null): Record<string, Cell> {
  return Object.fromEntries(KPI_SPECS.map((spec) => [kpiValueHeader(spec), kpis?.[spec.id] ?? '']));
}

export function yesNo(value: boolean): 'Yes' | 'No' {
  return value ? 'Yes' : 'No';
}

/** A Summary sheet row of context: a label and its value, no change or trend. */
export function contextRow(metric: string, value: Cell): Record<string, Cell> {
  return {
    Metric: metric,
    Value: value,
    Change: '',
    Trend: '',
  };
}

/** The Summary sheet's KPI rows: each KPI's value, its change and its trend. */
export function kpiSummaryRows(
  kpis: BrandKpis,
  deltas: KpiDeltas | undefined,
  trendOf: (id: KpiId) => KpiTrend | undefined,
): Array<Record<string, Cell>> {
  return KPI_SPECS.map((spec) => ({
    Metric: kpiValueHeader(spec),
    Value: kpis[spec.id] ?? '',
    Change: deltas?.[spec.id] ?? '',
    Trend: trendOf(spec.id) ?? '',
  }));
}

/** Excel column widths, in characters. */
export function sheetWidths(...characters: number[]): ExcelSheet['columns'] {
  // Stryker disable next-line ObjectLiteral,ArrowFunction: column widths are presentation only
  return characters.map((wch) => ({ wch }));
}

/** How each KPI of `definitions` is measured, one row each. */
export function definitionsSheet(definitions: readonly KpiDefinition[]): ExcelSheet {
  return {
    name: 'Definitions',
    columns: sheetWidths(18, 120),
    data: definitions.map(({
      label, definition
    }) => ({
      KPI: label,
      'How it is measured': definition,
    })),
  };
}
