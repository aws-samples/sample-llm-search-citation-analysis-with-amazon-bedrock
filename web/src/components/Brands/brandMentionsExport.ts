import { exportToExcel } from '../../exporters/excelGenerator';
import type { BrandMentionsResponse } from '../../types';

const BRAND_MENTION_COLUMNS = [
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

/** One export row for every provider appearance returned by the server. */
export function brandMentionsExcelRows(data: BrandMentionsResponse): Record<string, unknown>[] {
  return data.aggregated.brands.flatMap((brand) => brand.appearances.map((appearance) => ({
    Keyword: appearance.keyword,
    Brand: brand.name,
    Classification: brand.classification,
    Provider: appearance.provider,
    Model: appearance.model || appearance.provider,
    Rank: appearance.rank ?? '',
    Mentions: appearance.mention_count ?? '',
    'First position': appearance.first_position ?? '',
    Sentiment: appearance.sentiment ?? '',
  })));
}

export function brandMentionsFileName(scopeLabel: string, date = new Date()): string {
  const slug = scopeLabel.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '') || 'keywords';
  return `brand-mentions-${slug}-${date.toISOString().slice(0, 10)}.xlsx`;
}

export async function exportBrandMentions(
  data: BrandMentionsResponse,
  scopeLabel: string,
  date = new Date()
): Promise<void> {
  await exportToExcel({
    data: brandMentionsExcelRows(data),
    columns: BRAND_MENTION_COLUMNS,
    sheetName: 'Brand Mentions',
    fileName: brandMentionsFileName(scopeLabel, date),
  });
}
