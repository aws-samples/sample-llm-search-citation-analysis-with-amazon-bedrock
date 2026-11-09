import { vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { BrandExpansionAllResult } from '../../types';
import { FirstPartyBrandsSection } from './FirstPartyBrandsSection';

type SectionProps = ComponentProps<typeof FirstPartyBrandsSection>;

/** What "Suggest sub-brands" answered for the Altiplano Air list: one missing sub-brand and one likely duplicate. */
export const SKY_ANDES_EXPANSION: BrandExpansionAllResult = {
  existing_brands: ['Altiplano Air'],
  suggestions: ['Sky Andes'],
  duplicates_found: [{
    brand: 'Altiplano',
    duplicate_of: 'Altiplano Air'
  }],
};

/** "Your brand" with Altiplano Air and one website, suggestions allowed, a fresh spy per callback. */
export function renderFirstPartySection(overrides: Partial<SectionProps> = {}): SectionProps {
  const props: SectionProps = {
    brands: ['Altiplano Air'],
    newBrand: '',
    domains: ['altiplano.example'],
    newDomain: '',
    expanding: false,
    expansionResult: null,
    pendingBrands: [],
    canExpand: true,
    onNewBrandChange: vi.fn(),
    onAddBrand: vi.fn(),
    onRemoveBrand: vi.fn(),
    onNewDomainChange: vi.fn(),
    onAddDomain: vi.fn(),
    onRemoveDomain: vi.fn(),
    onExpandAll: vi.fn(),
    onTogglePending: vi.fn(),
    onAcceptExpansion: vi.fn(),
    onCancelExpansion: vi.fn(),
    ...overrides,
  };
  render(<FirstPartyBrandsSection {...props} />);
  return props;
}
