import {
  exportToExcel, scopedExcelFileName
} from '../../exporters/excelGenerator';
import type { BrandAppearanceRow } from '../../types';
import {
  fetchBrandAppearances, type BrandAppearancesRequest
} from '../../api/brandMentions';

/** Column widths of the one-row-per-appearance brand mentions sheet. */
export const BRAND_MENTION_COLUMNS = [
  { wch: 36 },
  { wch: 28 },
  { wch: 16 },
  { wch: 16 },
  { wch: 24 },
  { wch: 14 },
  { wch: 12 },
  { wch: 16 },
  { wch: 16 },
];

/** One export row for every appearance the server's `view=appearances` pages returned. */
export function brandMentionsExcelRows(appearances: readonly BrandAppearanceRow[]): Record<string, unknown>[] {
  return appearances.map((appearance) => ({
    Keyword: appearance.keyword,
    Brand: appearance.brand,
    Classification: appearance.classification,
    Provider: appearance.provider,
    Model: appearance.model || appearance.provider,
    Rank: appearance.rank ?? '',
    Mentions: appearance.mention_count ?? '',
    'First position': appearance.first_position ?? '',
    Sentiment: appearance.sentiment ?? '',
  }));
}

export function brandMentionsFileName(scopeLabel: string, date = new Date()): string {
  return scopedExcelFileName('brand-mentions', scopeLabel, date);
}

export async function exportBrandMentions(
  appearances: readonly BrandAppearanceRow[],
  scopeLabel: string,
  date = new Date()
): Promise<void> {
  await exportToExcel({
    data: brandMentionsExcelRows(appearances),
    columns: BRAND_MENTION_COLUMNS,
    sheetName: 'Brand Mentions',
    fileName: brandMentionsFileName(scopeLabel, date),
  });
}

/** Reads every appearance `request` selects (following `next_token`) and exports them. */
export async function exportBrandMentionsFor(
  request: BrandAppearancesRequest,
  scopeLabel: string,
  date = new Date()
): Promise<void> {
  await exportBrandMentions(await fetchBrandAppearances(request), scopeLabel, date);
}
