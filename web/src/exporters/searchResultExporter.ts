/** The search fields the Excel export reads. */
export interface ExportableSearch {
  keyword: string;
  provider: string;
  timestamp: string;
  citations?: string[];
}

/**
 * One Excel row per citation of a search, or a single "No citations"
 * placeholder row. Used by the SearchesView export.
 */
export function searchExcelRows(search: ExportableSearch): Record<string, unknown>[] {
  const row = (citationNumber: number, citationUrl: string): Record<string, unknown> => ({
    Keyword: search.keyword,
    Provider: search.provider,
    Timestamp: new Date(search.timestamp).toLocaleString(),
    'Citation #': citationNumber,
    'Citation URL': citationUrl,
  });
  if (search.citations && search.citations.length > 0) {
    return search.citations.map((citation, idx) => row(idx + 1, citation));
  }
  return [row(0, 'No citations')];
}

export const SEARCH_EXCEL_COLUMNS = [
  { wch: 25 },
  { wch: 12 },
  { wch: 20 },
  { wch: 12 },
  { wch: 80 },
];
