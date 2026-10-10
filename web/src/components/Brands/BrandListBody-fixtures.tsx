import { vi } from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { BrandExpansionAllResult } from '../../types';
import { BrandListBody } from './BrandListBody';

type BrandListBodyProps = ComponentProps<typeof BrandListBody>;

/** What "Expand Brand" answered for the Altiplano Air list: one missing sub-brand. */
export const SKY_ANDES_EXPANSION: BrandExpansionAllResult = {
  existing_brands: ['Altiplano Air'],
  suggestions: ['Sky Andes'],
  duplicates_found: [],
};

/** The first-party list holding Altiplano Air and Condor Sur, with a fresh spy per callback. */
function buildProps(overrides: Partial<BrandListBodyProps> = {}): BrandListBodyProps {
  return {
    brands: ['Altiplano Air', 'Condor Sur'],
    newBrand: '',
    selectedBrand: null,
    expansionResult: null,
    expansionTarget: null,
    pendingBrands: [],
    onNewBrandChange: vi.fn(),
    onAddBrand: vi.fn(),
    onRemoveBrand: vi.fn(),
    onSelectBrand: vi.fn(),
    onTogglePending: vi.fn(),
    onAcceptExpansion: vi.fn(),
    onCancelExpansion: vi.fn(),
    target: 'first_party',
    colorScheme: 'emerald',
    hint: 'Your brands to track.',
    inputId: 'new-first-party-brand',
    inputLabel: 'New first party brand',
    placeholder: 'Enter brand name...',
    ...overrides,
  };
}

/** Mounts the body over `buildProps(overrides)` and returns the props, for asserting on the spies. */
export function renderBrandListBody(overrides: Partial<BrandListBodyProps> = {}): BrandListBodyProps {
  const props = buildProps(overrides);
  render(<BrandListBody {...props} />);
  return props;
}

/** The "add brand" input, found by its accessible name. */
export function getNewBrandInput(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>('New first party brand');
}
