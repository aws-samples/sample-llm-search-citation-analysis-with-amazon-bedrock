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

/** What "Find Competitors" answers: Cielo Wings with two suggested domains. */
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
    fireEvent.click(screen.getByRole('button', { name: 'Find Competitors' }));
  });
}

export async function saveConfiguration(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
  });
}

/** The checkbox of `domain` in the row of `brand`. */
export function competitorDomainCheckbox(domain: string, brand: string): HTMLElement {
  return screen.getByRole('checkbox', { name: `${domain} for ${brand}` });
}

/** Form edits a save test applies before saving. */
export async function tickSuggestedCieloDomain(): Promise<void> {
  await findCompetitors();
  fireEvent.click(competitorDomainCheckbox('cielo-wings.example', 'Cielo Wings'));
}

export function typeCieloDomainWithSchemeAndPath(): void {
  const input = screen.getByLabelText('New domain for Cielo Wings');
  fireEvent.change(input, { target: { value: 'https://www.Cielo-Wings.example/routes' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

export function untickStoredBorealisDomain(): void {
  fireEvent.click(competitorDomainCheckbox('borealis-air.com', 'Borealis Air'));
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
