import { render } from '@testing-library/react';
import type { AggregatedBrand } from '../../types';
import type { BrandAppearancesRequest } from '../../api/brandMentions';
import {
  buildAggregatedBrand, buildBrandAppearance
} from '../../hooks/useBrandMentions-fixtures';
import { BrandOverviewTab } from './BrandOverviewTab';

/** A brand with two previewed appearances out of `appearanceCount`. */
export function previewedBrand(appearanceCount = 7): AggregatedBrand {
  return buildAggregatedBrand({
    name: 'Hotel Coruña',
    appearances: [buildBrandAppearance(), buildBrandAppearance({ provider: 'gemini' })],
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
