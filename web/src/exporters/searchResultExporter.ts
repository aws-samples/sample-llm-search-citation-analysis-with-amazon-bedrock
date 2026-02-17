import { exportToExcel } from './excelGenerator';

interface KeywordGroup {
  keyword: string;
  searches: Array<{
    keyword: string;
    provider: string;
    timestamp: string;
    citations?: string[];
  }>;
  latestTimestamp: string;
  totalRuns: number;
  totalCitations: number;
  avgCitations: number;
  hasFailed: boolean;
}

export const downloadSearchesToExcel = async (keywordGroups: KeywordGroup[]) => {
  const excelData: Record<string, unknown>[] = [];

  keywordGroups.forEach((group) => {
    group.searches.forEach((search) => {
      if (search.citations && search.citations.length > 0) {
        search.citations.forEach((citation, idx) => {
          excelData.push({
            Keyword: search.keyword,
            Provider: search.provider,
            Timestamp: new Date(search.timestamp).toLocaleString(),
            'Citation #': idx + 1,
            'Citation URL': citation,
          });
        });
      } else {
        excelData.push({
          Keyword: search.keyword,
          Provider: search.provider,
          Timestamp: new Date(search.timestamp).toLocaleString(),
          'Citation #': 0,
          'Citation URL': 'No citations',
        });
      }
    });
  });

  await exportToExcel({
    data: excelData,
    columns: [{ wch: 25 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 80 }],
    sheetName: 'Recent Searches',
    fileName: `citation-searches-${new Date().toISOString().split('T')[0]}.xlsx`,
  });
};