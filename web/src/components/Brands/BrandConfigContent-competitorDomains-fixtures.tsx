import {
  render, screen, fireEvent, act
} from '@testing-library/react';
import { vi } from 'vitest';
import type {
  BrandConfig, CompetitorDiscoveryResult
} from '../../types';
import { buildBrandConfig } from '../../hooks/useBrandConfigFormFixtures';
import { BrandConfigContent } from './BrandConfigContent';

/** The competitor domains `AIRLINE_CONFIG` has saved. */
export const STORED_COMPETITOR_DOMAINS = { 'Borealis Air': ['borealis-air.com'] };

/** Aurora Airways tracking Borealis Air and Cielo Wings, with one Borealis domain saved. */
export const AIRLINE_CONFIG: BrandConfig = buildBrandConfig({
  industry: 'general',
  tracked_brands: {
    first_party: ['Aurora Airways'],
    competitors: ['Borealis Air', 'Cielo Wings'],
  },
  first_party_domains: ['aurora-airways.example'],
  competitor_domains: STORED_COMPETITOR_DOMAINS,
});

/** `AIRLINE_CONFIG` still holding the domains of a competitor no longer tracked. */
export const CONFIG_WITH_FORMER_RIVAL: BrandConfig = {
  ...AIRLINE_CONFIG,
  competitor_domains: {
    ...STORED_COMPETITOR_DOMAINS,
    'Former Rival': ['former.example'],
  },
};

/** `AIRLINE_CONFIG` with Borealis Air at the ten-domain cap. */
export const CONFIG_AT_DOMAIN_CAP: BrandConfig = {
  ...AIRLINE_CONFIG,
  competitor_domains: { 'Borealis Air': Array.from({ length: 10 }, (_unused, index) => `site${index}.borealis.example`) },
};

/** What "Find competitors" answers: Cielo Wings with two suggested domains. */
const DISCOVERY: CompetitorDiscoveryResult = {
  first_party_brands: ['Aurora Airways'],
  competitors: ['Cielo Wings'],
  suggested_domains: { 'Cielo Wings': ['cielo-wings.example', 'fly-cielo.example'] },
};

/** Renders the form for `config`; the returned `onSave` records each saved config. */
export function renderCompetitorDomainsForm(config: BrandConfig = AIRLINE_CONFIG) {
  const onSave = vi.fn<(saved: BrandConfig) => Promise<void>>(() => Promise.resolve());
  const onFindCompetitors = vi.fn(() => Promise.resolve(DISCOVERY));
  render(<BrandConfigContent config={config} presets={null} loading={false} onSave={onSave} onFindCompetitors={onFindCompetitors} />);
  return { onSave };
}

export async function findCompetitors(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Find competitors' }));
  });
}

/** Presses Save changes in the save bar (shown once the form has changes). */
export async function saveConfiguration(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  });
}

/** The sticky save bar, or `null` while there is nothing to save. */
export function querySaveBar(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Save changes' });
}

/** Types `value` into the box named `label` and presses Enter. */
export function typeAndEnter(label: string, value: string): void {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

/** The remove button of a saved `domain` in the row of `brand`. */
export function savedCompetitorDomain(domain: string, brand: string): HTMLElement {
  return screen.getByRole('button', { name: `Remove ${domain} from ${brand}` });
}

/** The dashed chip of a suggested, unsaved `domain` in the row of `brand`. */
export function suggestedCompetitorDomain(domain: string, brand: string): HTMLElement {
  return screen.getByRole('button', { name: `Add suggested ${domain} for ${brand}` });
}

/** Form edits a save test applies before saving. */
export function addFirstPartyBrand(): void {
  typeAndEnter('Add brand name', 'Aurora Express');
}

export async function findCompetitorsAndEditBrands(): Promise<void> {
  await findCompetitors();
  addFirstPartyBrand();
}

export async function pickSuggestedCieloDomain(): Promise<void> {
  await findCompetitors();
  fireEvent.click(suggestedCompetitorDomain('cielo-wings.example', 'Cielo Wings'));
}

export function typeCieloDomainWithSchemeAndPath(): void {
  typeAndEnter('Add website for Cielo Wings', 'https://www.Cielo-Wings.example/routes');
}

export function removeStoredBorealisDomain(): void {
  fireEvent.click(savedCompetitorDomain('borealis-air.com', 'Borealis Air'));
}

/** Renders `config`, applies `edit`, saves, and answers the `competitor_domains` that were saved. */
export async function competitorDomainsSavedAfter(
  edit: () => void | Promise<void>,
  config: BrandConfig = AIRLINE_CONFIG
): Promise<BrandConfig['competitor_domains']> {
  const { onSave } = renderCompetitorDomainsForm(config);
  await edit();
  await saveConfiguration();
  return onSave.mock.lastCall?.[0].competitor_domains;
}
