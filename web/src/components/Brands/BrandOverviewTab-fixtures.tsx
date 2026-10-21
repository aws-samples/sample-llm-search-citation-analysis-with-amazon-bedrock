import { render } from '@testing-library/react';
import type {
  AggregatedBrand, BrandAppearance
} from '../../types';
import type { BrandAppearancesRequest } from '../../api/brandMentions';
import { buildAggregatedBrand } from '../../hooks/useBrandMentions-fixtures';
import { BrandOverviewTab } from './BrandOverviewTab';

export function buildPreviewAppearance(overrides: Partial<BrandAppearance> = {}): BrandAppearance {
  return {
    keyword: 'hotel coruna spa',
    provider: 'openai',
    model: 'gpt-5-mini',
    rank: 1,
    mention_count: 1,
    first_position: 10,
    sentiment: 'positive',
    ...overrides,
  };
}

/** A brand with two previewed appearances out of `appearanceCount`. */
export function previewedBrand(appearanceCount = 7): AggregatedBrand {
  return buildAggregatedBrand({
    name: 'Hotel Coruña',
    appearances: [buildPreviewAppearance(), buildPreviewAppearance({ provider: 'gemini' })],
    appearance_count: appearanceCount,
    sentiment_counts: {
      positive: 4,
      negative: 3,
    },
  });
}

export const GROUP_APPEARANCES_REQUEST: BrandAppearancesRequest = {
  scope: {
    kind: 'group',
    groupId: 'group-coruna',
  },
  marketId: null,
  filters: { timestamp: null },
};

export function renderOverview(brand: AggregatedBrand, request: BrandAppearancesRequest | null = GROUP_APPEARANCES_REQUEST) {
  return render(<BrandOverviewTab brand={brand} appearancesRequest={request} />);
}
