import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import {
  SKY_ANDES_EXPANSION, renderFirstPartySection
} from './FirstPartyBrandsSection-fixtures';
import type { FirstPartyBrandsSection } from './FirstPartyBrandsSection';

type CallbackName = 'onRemoveDomain' | 'onExpandAll' | 'onTogglePending' | 'onAcceptExpansion';

describe('FirstPartyBrandsSection', () => {
  it('names the section and labels both fields', () => {
    renderFirstPartySection();

    expect(screen.getByRole('region', { name: 'Your brand' })).toBeInTheDocument();
    expect(screen.getByLabelText('Add brand name')).toHaveAttribute('id', 'new-first-party-brand');
    expect(screen.getByLabelText('Add website')).toHaveAttribute('id', 'new-first-party-domain');
  });

  it('says what an empty website list costs', () => {
    renderFirstPartySection({ domains: [] });

    expect(screen.getByText(/No websites yet/)).toBeInTheDocument();
  });

  it.each([
    ['removes a website from its chip', 'Remove altiplano.example', {}, 'onRemoveDomain', [['altiplano.example']]],
    ['asks for sub-brands from its secondary action', 'Suggest sub-brands', {}, 'onExpandAll', [[]]],
    ['wires the suggestion toggles to onTogglePending', 'Sky Andes', { expansionResult: SKY_ANDES_EXPANSION }, 'onTogglePending', [['Sky Andes']]],
    ['adds the picked suggestions with the count on the button', 'Add 1 selected', {
      expansionResult: SKY_ANDES_EXPANSION,
      pendingBrands: ['Sky Andes'] 
    }, 'onAcceptExpansion', [[]]],
  ] satisfies ReadonlyArray<[string, string, Partial<ComponentProps<typeof FirstPartyBrandsSection>>, CallbackName, unknown[][]]>)('%s', (_name, button, overrides, callback, calls) => {
    const props = renderFirstPartySection(overrides);

    fireEvent.click(screen.getByRole('button', { name: button }));

    expect(vi.mocked(props[callback]).mock.calls).toStrictEqual(calls);
  });

  it.each([
    ['suggestions are not allowed', { canExpand: false }],
    ['there is no brand to expand', { brands: [] }],
  ])('offers no sub-brand suggestions when %s', (_why, overrides) => {
    renderFirstPartySection(overrides);

    expect(screen.queryByRole('button', { name: 'Suggest sub-brands' })).not.toBeInTheDocument();
  });

  it('shows the busy label while the suggestions load', () => {
    renderFirstPartySection({ expanding: true });

    expect(screen.getByRole('button', { name: 'Suggesting…' })).toBeDisabled();
  });

  it('shows the sub-brand suggestions unpicked, the likely duplicates and a disabled Add once expanded', () => {
    renderFirstPartySection({ expansionResult: SKY_ANDES_EXPANSION });

    expect(screen.getByRole('button', { name: 'Sky Andes' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/Altiplano. may be the same as .Altiplano Air/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add 0 selected' })).toBeDisabled();
  });
});
