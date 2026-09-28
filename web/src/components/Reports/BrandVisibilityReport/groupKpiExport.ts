/**
 * Excel export of the per-hotel report: every sheet a reader needs to rework
 * the numbers or share them — the headline, how each KPI is measured, the KPI
 * history per run, what drove each change, every keyword's runs and, when
 * available, the brand mentions behind the selected run.
 *
 * An unknown value is an empty cell (`?? ''`), never `null` or a dash, so a
 * spreadsheet can still compute with the column.
 */
import {
  exportWorkbook, scopedExcelFileName, type ExcelSheet
} from '../../../exporters/excelGenerator';
import type {
  GroupKpiField, GroupKpiHistoryResponse, GroupRun, KeywordRunHistory, MentionChange
} from '../../../types/domain/groupKpiHistory';
import type { BrandMentionsResponse } from '../../../types';
import { VISIBILITY_KPI_DEFINITIONS } from '../../../constants/kpiDefinitions';
import {
  BRAND_MENTION_COLUMNS, brandMentionsExcelRows
} from '../../Brands/brandMentionsExport';

/** Excel column widths, in characters. */
function widths(...characters: number[]): ExcelSheet['columns'] {
  // Stryker disable next-line ObjectLiteral,ArrowFunction: column widths are presentation only
  return characters.map((wch) => ({ wch }));
}

function yesNo(value: boolean): 'Yes' | 'No' {
  return value ? 'Yes' : 'No';
}

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

function summarySheet(history: GroupKpiHistoryResponse, scopeLabel: string, run: GroupRun, generatedAt: Date): ExcelSheet {
  const { summary } = run;
  // A run without a comparison has no changes: every change cell is empty.
  const deltas: Partial<Record<GroupKpiField, number | null>> = run.change?.deltas ?? {};
  const rows: [string, string | number | null | undefined][] = [
    ['Keyword group', scopeLabel],
    ['Period (days)', history.days],
    ['Generated at', generatedAt.toISOString()],
    ['Run', run.timestamp],
    ['Group run', yesNo(run.is_group_run)],
    ['Keywords with results', `${run.keywords_with_data} of ${run.keywords_total}`],
    ['Compared with run', run.change?.previous_timestamp ?? null],
    ['Citation rate (%)', summary.coverage_rate],
    ['Citation rate change (pts)', deltas.coverage_rate],
    ['Share of voice (%)', summary.first_party_avg_sov],
    ['Share of voice change (pts)', deltas.first_party_avg_sov],
    ['Prominence: rank #1 share (%)', summary.rank_1_share],
    ['Rank #1 share change (pts)', deltas.rank_1_share],
    ['Prominence: top-3 share (%)', summary.top_3_share],
    ['Top-3 share change (pts)', deltas.top_3_share],
    ['Prominence: mean rank', summary.mean_rank],
    ['Mean rank change', deltas.mean_rank],
    ['Group run threshold (% of keywords)', history.group_run_min_coverage],
  ];
  return {
    name: 'Summary',
    columns: widths(38, 32),
    data: rows.map(([metric, value]) => ({
      Metric: metric,
      Value: value ?? '',
    })),
  };
}

function definitionsSheet(): ExcelSheet {
  return {
    name: 'Definitions',
    columns: widths(18, 120),
    data: VISIBILITY_KPI_DEFINITIONS.map((entry) => ({
      KPI: entry.label,
      'How it is measured': entry.definition,
    })),
  };
}

function historySheet(runs: readonly GroupRun[]): ExcelSheet {
  return {
    name: 'KPI history',
    columns: widths(28, 10, 12, 12, 14, 14, 14, 14, 12, 12, 16, 16, 16, 14, 60),
    data: runs.map((run) => ({
      Run: run.timestamp,
      'Group run': yesNo(run.is_group_run),
      'Keywords with results': run.keywords_with_data,
      'Keywords total': run.keywords_total,
      'Citation rate (%)': run.summary.coverage_rate,
      'Share of voice (%)': run.summary.first_party_avg_sov,
      'Rank #1 share (%)': run.summary.rank_1_share,
      'Top-3 share (%)': run.summary.top_3_share,
      'Mean rank': run.summary.mean_rank ?? '',
      'Compared with run': run.change?.previous_timestamp ?? '',
      'Citation rate change (pts)': run.change?.deltas.coverage_rate ?? '',
      'Share of voice change (pts)': run.change?.deltas.first_party_avg_sov ?? '',
      'Rank #1 share change (pts)': run.change?.deltas.rank_1_share ?? '',
      'Mean rank change': run.change?.deltas.mean_rank ?? '',
      Models: modelsCell(run),
    })),
  };
}

function driverRows(run: GroupRun): Record<string, unknown>[] {
  const { change } = run;
  if (change === null) return [];
  return change.drivers.map((driver) => ({
    Run: run.timestamp,
    'Compared with run': change.previous_timestamp,
    Keyword: driver.keyword,
    'Hotel mention': mentionChange(driver.changes.mention),
    'Citation rate impact (pts)': driver.impact.coverage_rate,
    'Share of voice change (pts)': driver.changes.first_party_sov ?? '',
    'SOV impact (pts)': driver.impact.first_party_avg_sov,
    'Rank #1 share change (pts)': driver.changes.rank_1_share ?? '',
    'Top-3 share change (pts)': driver.changes.top_3_share ?? '',
    'Mean rank change': driver.changes.mean_rank ?? '',
  }));
}

function driversSheet(runs: readonly GroupRun[]): ExcelSheet {
  return {
    name: 'Drivers',
    columns: widths(28, 28, 40, 20, 18, 16, 14, 16, 16, 14),
    data: runs.flatMap(driverRows),
  };
}

function keywordRunsSheet(keywords: readonly KeywordRunHistory[]): ExcelSheet {
  return {
    name: 'Keyword runs',
    columns: widths(40, 28, 10, 20, 14, 16, 14, 16, 12, 14, 12, 10, 18, 12),
    data: keywords.flatMap((entry) => entry.runs.map((run) => ({
      Keyword: entry.keyword,
      Run: run.timestamp,
      'Hotel mentioned': yesNo(run.first_party_mentioned),
      'Mention change': mentionChange(run.change?.mention),
      'Share of voice (%)': run.first_party_sov,
      'Share of voice change (pts)': run.change?.first_party_sov ?? '',
      'Rank #1 share (%)': run.rank_1_share,
      'Top-3 share (%)': run.top_3_share,
      'Mean rank': run.mean_rank ?? '',
      'Mean rank change': run.change?.mean_rank ?? '',
      'Best rank': run.first_party_best_rank ?? '',
      Answers: run.answers,
      'Answers mentioning': run.mentioned_answers,
      'Hotel score': run.first_party_score,
    }))),
  };
}

/** Every sheet of the per-hotel workbook; the brand mentions sheet only when `mentions` is given. */
export function groupKpiReportSheets(
  history: GroupKpiHistoryResponse,
  scopeLabel: string,
  run: GroupRun,
  mentions: BrandMentionsResponse | null,
  generatedAt: Date,
): ExcelSheet[] {
  const sheets = [
    summarySheet(history, scopeLabel, run, generatedAt),
    definitionsSheet(),
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
  return scopedExcelFileName('hotel-visibility-report', scopeLabel, date);
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
