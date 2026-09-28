import type { BrandMentionsResponse } from '../../../types';
import type { ExcelSheet } from '../../../exporters/excelGenerator';
import {
  buildChange, buildDriver, buildHistory, buildKeywordHistory, buildKeywordRun, buildRun, buildSummary, RUN_2
} from './groupKpiHistory-fixtures';
import { groupKpiReportSheets } from './groupKpiExport';

/** When every fixture workbook was generated. */
export const EXPORTED_AT = new Date('2026-09-28T12:00:00.000Z');

/** `/brand-mentions` for the hotel group at RUN_2: one first-party appearance. */
export const BRAND_MENTIONS_AT_RUN: BrandMentionsResponse = {
  keyword: null,
  timestamp: RUN_2,
  available_runs: [RUN_2],
  config: null,
  by_provider: [],
  aggregated: {
    brands: [{
      name: 'Hotel Sol',
      parent_company: null,
      provider_count: 1,
      total_mentions: 2,
      best_rank: 1,
      overall_rank: 1,
      aggregate_score: 80,
      classification: 'first_party',
      providers: ['openai'],
      appearances: [{
        keyword: 'hotel sol spa',
        provider: 'openai',
        model: 'gpt-5.2',
        rank: 1,
        mention_count: 2,
        first_position: 10,
        sentiment: 'positive',
      }],
    }],
    total_unique_brands: 1,
    first_party_brands: [],
    competitor_brands: [],
    summary: {
      first_party_count: 1,
      competitor_count: 0,
      other_count: 0,
    },
  },
};

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
export function selectedRunSheets(mentions: BrandMentionsResponse | null = BRAND_MENTIONS_AT_RUN): ExcelSheet[] {
  const history = buildHistory();
  return groupKpiReportSheets(history, 'Hotel Sol', history.runs[1], mentions, EXPORTED_AT);
}


/** A workbook write that failed. */
export class WorkbookWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookWriteError';
  }
}


/**
 * A workbook where every optional value is unknown: a group run whose change
 * has only unknown deltas and a driver with only unknown changes, and a
 * keyword run that gained the hotel without a rank.
 */
export function unknownValueSheets(): ExcelSheet[] {
  const base = buildHistory();
  const unknownDeltas = {
    coverage_rate: null,
    first_party_avg_sov: null,
    rank_1_share: null,
    top_3_share: null,
    mean_rank: null,
  };
  const run = buildRun({
    summary: buildSummary({ mean_rank: null }),
    change: buildChange({
      deltas: unknownDeltas,
      drivers: [buildDriver({
        changes: {
          mention: null,
          first_party_sov: null,
          rank_1_share: null,
          top_3_share: null,
          mean_rank: null,
        },
      })],
    }),
  });
  const history = {
    ...base,
    runs: [run],
    keywords: [buildKeywordHistory('k', [buildKeywordRun({
      mean_rank: null,
      first_party_best_rank: null,
      change: {
        previous_timestamp: RUN_2,
        mention: 'gained' as const,
        first_party_sov: null,
        rank_1_share: null,
        top_3_share: null,
        mean_rank: null,
      },
    })])],
  };
  return groupKpiReportSheets(history, 'Hotel Sol', run, null, EXPORTED_AT);
}
