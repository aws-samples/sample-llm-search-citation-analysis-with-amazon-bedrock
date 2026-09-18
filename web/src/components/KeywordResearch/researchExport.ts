import { exportToExcel } from '../../exporters/excelGenerator';
import type { ResearchKeyword } from '../../types';

/** Rows of the keyword research Excel sheet, in the table's current order. */
export function researchExcelRows(keywords: ResearchKeyword[]): Record<string, unknown>[] {
  return keywords.map((keyword) => ({
    Keyword: keyword.keyword,
    Intent: keyword.intent ?? '',
    Competition: keyword.competition ?? '',
    Relevance: keyword.relevance ?? '',
    Opportunity: keyword.opportunity ?? '',
    Providers: (keyword.providers ?? []).join(', '),
  }));
}

export function researchExcelFileName(title: string, date = new Date()): string {
  const slug = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '').slice(0, 60) || 'keywords';
  return `keyword-research-${slug}-${date.toISOString().slice(0, 10)}.xlsx`;
}

export async function exportResearchKeywords(keywords: ResearchKeyword[], title: string): Promise<void> {
  await exportToExcel({
    data: researchExcelRows(keywords),
    columns: [{ wch: 45 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 28 }],
    sheetName: 'Keywords',
    fileName: researchExcelFileName(title),
  });
}
