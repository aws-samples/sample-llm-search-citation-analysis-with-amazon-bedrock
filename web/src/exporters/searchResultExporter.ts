import { exportToExcel } from './excelGenerator';

/** The search fields the Excel export reads. */
export interface ExportableSearch {
  keyword: string;
  provider: string;
  timestamp: string;
  citations?: string[];
}

interface KeywordGroup {
  keyword: string;
  searches: ExportableSearch[];
  latestTimestamp: string;
  totalRuns: number;
  totalCitations: number;
  avgCitations: number;
  hasFailed: boolean;
}

/**
 * One Excel row per citation of a search, or a single "No citations"
 * placeholder row. Shared by the SearchesView export and
 * `downloadSearchesToExcel` (bugs.md 4.4 — previously byte-identical copies).
 */
export function searchExcelRows(search: ExportableSearch): Record<string, unknown>[] {
  if (search.citations && search.citations.length > 0) {
    return search.citations.map((citation, idx) => ({
      Keyword: search.keyword,
      Provider: search.provider,
      Timestamp: new Date(search.timestamp).toLocaleString(),
      'Citation #': idx + 1,
      'Citation URL': citation,
    }));
  }

  return [{
    Keyword: search.keyword,
    Provider: search.provider,
    Timestamp: new Date(search.timestamp).toLocaleString(),
    'Citation #': 0,
    'Citation URL': 'No citations',
  }];
}

export const SEARCH_EXCEL_COLUMNS = [
  { wch: 25 },
  { wch: 12 },
  { wch: 20 },
  { wch: 12 },
  { wch: 80 },
];

export const downloadSearchesToExcel = async (keywordGroups: KeywordGroup[]) => {
  const excelData = keywordGroups.flatMap(
    (group) => group.searches.flatMap(searchExcelRows)
  );

  await exportToExcel({
    data: excelData,
    columns: SEARCH_EXCEL_COLUMNS,
    sheetName: 'Recent Searches',
    fileName: `citation-searches-${new Date().toISOString().split('T')[0]}.xlsx`,
  });
};