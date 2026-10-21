import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { ProviderDeltaSection } from './ProviderDeltaSection';
import {
  buildAggregatedBrand, mockBrandMentionsResponse
} from '../../../../hooks/useBrandMentions-fixtures';
import type { AggregatedBrand } from '../../../../types';

const HOTEL = buildAggregatedBrand({
  name: 'Hotel Coruña',
  providers: ['gemini', 'openai'],
  provider_ranks: {
    gemini: 4,
    openai: 1,
  },
});

const RIVAL = buildAggregatedBrand({
  name: 'Rival Inn',
  classification: 'competitor',
  providers: ['claude'],
  provider_ranks: { claude: 1 },
});

const SECOND = buildAggregatedBrand({
  name: 'Hotel Marina',
  providers: ['openai'],
  provider_ranks: { openai: 2 },
});

function renderSection(brands: AggregatedBrand[]) {
  return render(
    <ProviderDeltaSection
      mentions={{
        ...mockBrandMentionsResponse,
        aggregated: {
          ...mockBrandMentionsResponse.aggregated,
          brands,
        },
      }}
      loading={false}
      error={null}
    />
  );
}

describe('ProviderDeltaSection', () => {
  it('shows each provider’s best rank of a first-party brand', () => {
    renderSection([HOTEL]);

    const row = screen.getByRole('row', { name: /Hotel Coruña/ });
    expect(row).toHaveTextContent('Hotel Coruña#4#1#1');
  });

  it('marks a provider that did not name the brand with a dash', () => {
    renderSection([HOTEL, SECOND]);

    expect(screen.getByRole('row', { name: /Hotel Marina/ })).toHaveTextContent('Hotel Marina—#2#1');
  });

  it('leaves competitors out of the table', () => {
    renderSection([HOTEL, RIVAL]);

    expect(screen.queryByRole('columnheader', { name: 'claude' })).not.toBeInTheDocument();
  });

  it('explains an empty table when no first-party brand was named', () => {
    renderSection([RIVAL]);

    expect(screen.getByText(/No first-party brand mentions for this keyword/)).toBeInTheDocument();
  });
});
