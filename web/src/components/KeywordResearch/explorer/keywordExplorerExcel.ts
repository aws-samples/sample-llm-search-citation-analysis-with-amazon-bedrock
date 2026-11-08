/**
 * Excel export of the Keyword Explorer's filtered and sorted rows (what the table shows), raw numbers.
 */
import {
  exportTableToExcel, rounded, type ExcelTableColumn
} from '../../../exporters/tableExcel';
import type { KeywordRow } from '../../../types/api/seo';

export const KEYWORD_EXCEL_COLUMNS: ReadonlyArray<ExcelTableColumn<KeywordRow>> = [
  {
    header: 'Keyword',
    value: (row) => row.keyword 
  },
  {
    header: 'Volume',
    value: (row) => row.search_volume 
  },
  {
    header: 'CPC (USD)',
    value: (row) => rounded(row.cpc, 2) 
  },
  {
    header: 'Competition',
    value: (row) => rounded(row.competition, 2) 
  },
  {
    header: 'Difficulty',
    value: (row) => row.keyword_difficulty 
  },
  {
    header: 'Intent',
    value: (row) => row.intent 
  },
];

/** `keyword-explorer-<seed slug>-<YYYY-MM-DD>.xlsx`, one "Keywords" sheet. */
export function exportKeywordRowsExcel(rows: readonly KeywordRow[], seed: string): Promise<void> {
  return exportTableToExcel({
    columns: KEYWORD_EXCEL_COLUMNS,
    rows,
    sheetName: 'Keywords',
    filePrefix: 'keyword-explorer',
    scopeLabel: seed,
  });
}
