import type { ExcelSheet } from '../../exporters/excelGenerator';
import type {
  HistoricalTrendsResponse, VisibilityResponse
} from '../../types';
import { visibilityOverviewSheets } from './visibilityOverviewExport';
import {
  buildTrendsResponse, buildVisibility
} from './visibilityOverview-fixtures';

interface OverviewSheets {
  readonly summary: ExcelSheet;
  readonly definitions: ExcelSheet;
  readonly keywords: ExcelSheet;
  readonly brands: ExcelSheet;
  readonly engines: ExcelSheet;
  readonly sources: ExcelSheet;
  readonly history: ExcelSheet;
}

/**
 * The Visibility workbook of "Hotel Sol", sheet by sheet: `buildVisibility()`
 * and `buildTrendsResponse()` unless overridden. Call it inside a test, never
 * at import, so a broken export fails that test instead of the whole file.
 */
export function buildOverviewSheets(
  visibility: VisibilityResponse = buildVisibility(),
  trends: HistoricalTrendsResponse | null = buildTrendsResponse(),
): OverviewSheets {
  const [summary, definitions, keywords, brands, engines, sources, history] = visibilityOverviewSheets(visibility, trends, 'Hotel Sol');
  return {
    summary,
    definitions,
    keywords,
    brands,
    engines,
    sources,
    history,
  };
}

/** The Summary row of `metric`, if any. */
export function summaryRow(sheets: OverviewSheets, metric: string): Record<string, unknown> | undefined {
  return sheets.summary.data.find((row) => row.Metric === metric);
}
