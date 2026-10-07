import {
  fireEvent, render, screen
} from '@testing-library/react';
import {
  describe, it, expect, vi
} from 'vitest';
import { BrandConfigContent } from './BrandConfigContent';
import { mockBrandConfig } from '../../hooks/useBrandConfig-fixtures';
import { buildBrandConfig } from '../../hooks/useBrandConfigFormFixtures';
import {
  CONFIG_AT_DOMAIN_CAP,
  CONFIG_WITH_FORMER_RIVAL,
  STORED_COMPETITOR_DOMAINS,
  competitorDomainCheckbox,
  competitorDomainsSavedAfter,
  findCompetitors,
  renderCompetitorDomainsForm,
  saveConfiguration,
  tickSuggestedCieloDomain,
  typeCieloDomainWithSchemeAndPath,
  untickStoredBorealisDomain,
} from './BrandConfigContent-competitorDomains-fixtures';

vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: () => ({ isAdmin: true }) }));

function renderAndAddDomain(input: string) {
  render(
    <BrandConfigContent
      config={{
        ...mockBrandConfig,
        first_party_domains: [] 
      }}
      presets={null}
      loading={false}
      onSave={vi.fn()}
    />
  );
  fireEvent.change(screen.getByLabelText('New first party domain'), { target: { value: input } });
  fireEvent.keyDown(screen.getByLabelText('New first party domain'), { key: 'Enter' });
}

describe('BrandConfigContent owned domains', () => {
  it('adds the canonical domain when the input carries a scheme, www, port and path', () => {
    renderAndAddDomain('https://www.Example.com:443/rooms?view=sea');

    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('adds nothing when the input has no host', () => {
    renderAndAddDomain('https://');

    expect(screen.getByText(/No domains added/)).toBeInTheDocument();
  });
});

describe('BrandConfigContent states', () => {
  it('shows only the loading message while the configuration loads', () => {
    render(<BrandConfigContent config={mockBrandConfig} presets={null} loading onSave={vi.fn()} />);

    expect(screen.getByText('Loading configuration...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Configuration' })).not.toBeInTheDocument();
  });

  it('confirms a save only once it has completed', async () => {
    render(<BrandConfigContent config={mockBrandConfig} presets={null} loading={false} onSave={vi.fn(() => Promise.resolve())} />);
    expect(screen.queryByText('Saved!')).not.toBeInTheDocument();

    await saveConfiguration();

    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });
});

describe('BrandConfigContent competitor domains', () => {
  it('shows a saved competitor domain ticked on load', () => {
    renderCompetitorDomainsForm();

    expect(competitorDomainCheckbox('borealis-air.com', 'Borealis Air')).toBeChecked();
  });

  it('offers a new-domain input for every tracked competitor', () => {
    renderCompetitorDomainsForm();

    expect(screen.getByLabelText('New domain for Borealis Air')).toBeInTheDocument();
    expect(screen.getByLabelText('New domain for Cielo Wings')).toBeInTheDocument();
  });

  it('asks for competitor brands when none are tracked', () => {
    renderCompetitorDomainsForm(buildBrandConfig({
      tracked_brands: {
        first_party: ['Aurora Airways'],
        competitors: [] 
      } 
    }));

    expect(screen.getByText('Add competitor brands to record their domains')).toBeInTheDocument();
  });

  it('shows each suggested domain unticked next to its competitor', async () => {
    renderCompetitorDomainsForm();

    await findCompetitors();

    expect(competitorDomainCheckbox('cielo-wings.example', 'Cielo Wings')).not.toBeChecked();
    expect(competitorDomainCheckbox('fly-cielo.example', 'Cielo Wings')).not.toBeChecked();
  });

  it('disables the new-domain input once a competitor has ten domains', () => {
    renderCompetitorDomainsForm(CONFIG_AT_DOMAIN_CAP);

    expect(screen.getByLabelText('New domain for Borealis Air')).toBeDisabled();
  });
});

describe('BrandConfigContent saved competitor domains', () => {
  const STORED_AND_CIELO = {
    ...STORED_COMPETITOR_DOMAINS,
    'Cielo Wings': ['cielo-wings.example'] 
  };

  it.each([
    ['keeps the stored domains when nothing is edited', vi.fn(), undefined, STORED_COMPETITOR_DOMAINS],
    ['leaves a suggested domain unsaved until the admin ticks it', findCompetitors, undefined, STORED_COMPETITOR_DOMAINS],
    ['saves a suggested domain once the admin ticks it', tickSuggestedCieloDomain, undefined, STORED_AND_CIELO],
    ['saves a typed domain in its canonical form', typeCieloDomainWithSchemeAndPath, undefined, STORED_AND_CIELO],
    ['removes a saved domain the admin unticks', untickStoredBorealisDomain, undefined, {}],
    ['drops the domains of a competitor no longer tracked', vi.fn(), CONFIG_WITH_FORMER_RIVAL, STORED_COMPETITOR_DOMAINS],
  ])('%s', async (_name, edit, config, expected) => {
    expect(await competitorDomainsSavedAfter(edit, config)).toStrictEqual(expected);
  });
});
