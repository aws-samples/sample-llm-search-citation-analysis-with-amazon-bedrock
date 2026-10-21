import type {
  BrandAppearanceRow, BrandAppearancesPage, ReportScope
} from '../types';

export const RUN = '2026-09-08T06:00:00.000000Z';

export const HOTEL_GROUP = {
  kind: 'group',
  groupId: 'hotel-sol',
} satisfies ReportScope;

export function buildAppearanceRow(overrides: Partial<BrandAppearanceRow> = {}): BrandAppearanceRow {
  return {
    brand: 'Hotel Sol',
    classification: 'first_party',
    overall_rank: 1,
    keyword: 'hotel sol spa',
    provider: 'openai',
    model: 'gpt-5.2',
    query_prompt_id: 'default',
    rank: 1,
    mention_count: 2,
    first_position: 10,
    sentiment: 'positive',
    ...overrides,
  };
}

export const APPEARANCE_PAGE_1: BrandAppearancesPage = {
  keyword: null,
  timestamp: RUN,
  brand: null,
  appearances: [buildAppearanceRow(), buildAppearanceRow({ provider: 'gemini' })],
  total_appearances: 3,
  next_token: 'eyJvZmZzZXQiOjJ9',
};

export const APPEARANCE_PAGE_2: BrandAppearancesPage = {
  ...APPEARANCE_PAGE_1,
  appearances: [buildAppearanceRow({
    brand: 'Rival Inn',
    classification: 'competitor',
    overall_rank: 2,
  })],
  next_token: null,
};
