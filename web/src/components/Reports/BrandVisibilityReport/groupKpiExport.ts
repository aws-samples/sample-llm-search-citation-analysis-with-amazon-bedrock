/**
 * Excel export of the per-group report: every sheet a reader needs to rework
 * the numbers or share them — every KPI of the selected run, how each KPI is
 * measured, the KPI history per run, what drove each change, every keyword's
 * runs and, when available, the brand mentions behind the selected run.
 *
 * An unknown value is an empty cell (`?? ''`), never `null` or a dash, so a
 * spreadsheet can still compute with the column.
 */
import {
  exportWorkbook, scopedExcelFileName, type ExcelSheet
} from '../../../exporters/excelGenerator';
import type {
  GroupKpiHistoryResponse, GroupRun, KeywordRunHistory, KpiDeltas, MentionChange
} from '../../../types/domain/groupKpiHistory';
import type { BrandMentionsResponse } from '../../../types';
import {
  GROUP_REPORT_DEFINITIONS, KPI_SPECS, type KpiSpec, type KpiUnit
} from '../../../constants/kpiDefinitions';
import {
  BRAND_MENTION_COLUMNS, brandMentionsExcelRows
} from '../../Brands/brandMentionsExport';
import {
  contextRow, definitionsSheet, kpiCells, kpiSummaryRows, sheetWidths, yesNo, type Cell
} from '../layout/kpiSheets';
import { runTrend } from './groupKpiView';

const MENTION_CHANGE_LABELS: Record<Exclude<MentionChange, null>, string> = {
  gained: 'Now mentioned',
  lost: 'No longer mentioned',
};

function mentionChange(change: MentionChange | undefined): string {
  return change === null || change === undefined ? '' : MENTION_CHANGE_LABELS[change];
}

function modelsCell(run: GroupRun): string {
  return Object.entries(run.models).map(([provider, models]) => `${provider}: ${models.join(', ')}`).join('; ');
}

const CHANGE_UNITS: Record<KpiUnit, string> = {
  count: '',
  percent: ' (pts)',
  position: ' (positions)',
  score: ' (pts)',
  net: ' (pts)',
};

/** The column heading of a KPI change, e.g. "Mention rate change (pts)". */
function kpiChangeHeader(spec: KpiSpec): string {
  return `${spec.label} change${CHANGE_UNITS[spec.unit]}`;
}

/** Every KPI change; all empty when there is no comparison. */
function changeCells(deltas: KpiDeltas | undefined): Record<string, Cell> {
  return Object.fromEntries(KPI_SPECS.map((spec) => [kpiChangeHeader(spec), deltas?.[spec.id] ?? '']));
}

function summarySheet(history: GroupKpiHistoryResponse, scopeLabel: string, run: GroupRun, generatedAt: Date): ExcelSheet {
  const context: [string, Cell][] = [
    ['Keyword group', scopeLabel],
    ['Period (days)', history.days],
    ['Generated at', generatedAt.toISOString()],
    ['Run', run.timestamp],
    ['Group run', yesNo(run.is_group_run)],
    ['Keywords with results', `${run.keywords_with_data} of ${run.keywords_total}`],
    ['AI engines', run.kpis.engines],
    ['Compared with run', run.change?.previous_timestamp ?? ''],
    ['Owned domains configured', yesNo(history.citations_configured)],
    ['Group run threshold (% of keywords)', history.group_run_min_coverage],
  ];
  return {
    name: 'Summary',
    columns: sheetWidths(38, 32, 18, 12),
    data: [
      ...context.map(([metric, value]) => contextRow(metric, value)),
      ...kpiSummaryRows(run.kpis, run.change?.deltas, (id) => runTrend(run, id)),
    ],
  };
}

function historySheet(runs: readonly GroupRun[]): ExcelSheet {
  return {
    name: 'KPI history',
    // Stryker disable next-line ArrowFunction: column widths are presentation only
    columns: sheetWidths(28, 10, 12, 12, ...KPI_SPECS.map(() => 16), 28, ...KPI_SPECS.map(() => 20), 60),
    data: runs.map((run) => ({
      Run: run.timestamp,
      'Group run': yesNo(run.is_group_run),
      'Keywords with results': run.keywords_with_data,
      'Keywords total': run.keywords_total,
      ...kpiCells(run.kpis),
      'Compared with run': run.change?.previous_timestamp ?? '',
      ...changeCells(run.change?.deltas),
      Models: modelsCell(run),
    })),
  };
}

function driverRows(run: GroupRun): Record<string, Cell>[] {
  const { change } = run;
  if (change === null) return [];
  return change.drivers.map((driver) => ({
    Run: run.timestamp,
    'Compared with run': change.previous_timestamp,
    Keyword: driver.keyword,
    'Brand mention': mentionChange(driver.mention),
    'Mention rate impact (pts)': driver.impact.mention_rate,
    'Visibility score impact (pts)': driver.impact.visibility_score,
    ...changeCells(driver.deltas),
  }));
}

function driversSheet(runs: readonly GroupRun[]): ExcelSheet {
  return {
    name: 'Drivers',
    // Stryker disable next-line ArrowFunction: column widths are presentation only
    columns: sheetWidths(28, 28, 40, 20, 18, 18, ...KPI_SPECS.map(() => 20)),
    data: runs.flatMap(driverRows),
  };
}

function keywordRunsSheet(keywords: readonly KeywordRunHistory[]): ExcelSheet {
  return {
    name: 'Keyword runs',
    // Stryker disable next-line ArrowFunction: column widths are presentation only
    columns: sheetWidths(40, 28, 20, ...KPI_SPECS.map(() => 16), ...KPI_SPECS.map(() => 20)),
    data: keywords.flatMap((entry) => entry.runs.map((run) => ({
      Keyword: entry.keyword,
      Run: run.timestamp,
      'Mention change': mentionChange(run.change?.mention),
      ...kpiCells(run.kpis),
      ...changeCells(run.change?.deltas),
    }))),
  };
}

/** Every sheet of the per-group workbook; the brand mentions sheet only when `mentions` is given. */
export function groupKpiReportSheets(
  history: GroupKpiHistoryResponse,
  scopeLabel: string,
  run: GroupRun,
  mentions: BrandMentionsResponse | null,
  generatedAt: Date,
): ExcelSheet[] {
  const sheets = [
    summarySheet(history, scopeLabel, run, generatedAt),
    definitionsSheet(GROUP_REPORT_DEFINITIONS),
    historySheet(history.runs),
    driversSheet(history.runs),
    keywordRunsSheet(history.keywords),
  ];
  if (mentions === null) return sheets;
  return [...sheets, {
    name: 'Brand mentions (run)',
    columns: BRAND_MENTION_COLUMNS,
    data: brandMentionsExcelRows(mentions),
  }];
}

export function groupKpiReportFileName(scopeLabel: string, date: Date): string {
  return scopedExcelFileName('group-visibility-report', scopeLabel, date);
}

export async function exportGroupKpiReport(
  history: GroupKpiHistoryResponse,
  scopeLabel: string,
  run: GroupRun,
  mentions: BrandMentionsResponse | null,
  date = new Date(),
): Promise<void> {
  await exportWorkbook(groupKpiReportSheets(history, scopeLabel, run, mentions, date), groupKpiReportFileName(scopeLabel, date));
}
