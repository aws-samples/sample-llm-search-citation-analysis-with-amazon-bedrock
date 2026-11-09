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
  addFirstPartyBrand,
  competitorDomainsSavedAfter,
  findCompetitors,
  findCompetitorsAndEditBrands,
  pickSuggestedCieloDomain,
  querySaveBar,
  removeStoredBorealisDomain,
  renderCompetitorDomainsForm,
  saveConfiguration,
  savedCompetitorDomain,
  suggestedCompetitorDomain,
  typeAndEnter,
  typeCieloDomainWithSchemeAndPath,
} from './BrandConfigContent-competitorDomains-fixtures';
import { TestError } from '../../test/testError';

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
  typeAndEnter('Add website', input);
}

describe('BrandConfigContent owned domains', () => {
  it('adds the canonical domain when the input carries a scheme, www, port and path', () => {
    renderAndAddDomain('https://www.Example.com:443/rooms?view=sea');

    expect(screen.getByRole('button', { name: 'Remove example.com' })).toBeInTheDocument();
  });

  it('adds nothing when the input has no host', () => {
    renderAndAddDomain('https://');

    expect(screen.getByText(/No websites yet/)).toBeInTheDocument();
  });
});

describe('BrandConfigContent states', () => {
  it('shows only the brand configuration skeleton while the configuration loads', () => {
    render(<BrandConfigContent config={mockBrandConfig} presets={null} loading onSave={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading brand configuration');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('shows the save bar only once something changed', () => {
    renderCompetitorDomainsForm();
    expect(querySaveBar()).toBeNull();

    addFirstPartyBrand();

    expect(querySaveBar()).toHaveTextContent('You have unsaved changes');
  });

  it('puts the stored values back on Discard and hides the bar', () => {
    renderCompetitorDomainsForm();
    addFirstPartyBrand();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect([screen.queryByRole('button', { name: 'Remove Aurora Express' }), querySaveBar()]).toStrictEqual([null, null]);
  });

  it('confirms a save only once it has completed', async () => {
    renderCompetitorDomainsForm();
    addFirstPartyBrand();
    expect(screen.queryByText('Changes saved')).not.toBeInTheDocument();

    await saveConfiguration();

    expect(screen.getByText('Changes saved')).toBeInTheDocument();
  });

  it('keeps the changes and says so when the save fails', async () => {
    const { onSave } = renderCompetitorDomainsForm();
    onSave.mockRejectedValueOnce(new TestError('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    addFirstPartyBrand();

    await saveConfiguration();

    expect(querySaveBar()).toHaveTextContent('Could not save your changes. Try again.');
  });

  it('keeps the extraction options and prompt collapsed under Advanced', () => {
    renderCompetitorDomainsForm();

    expect(screen.getByRole('button', { name: 'Advanced: extraction options and prompt' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Extraction Prompt/ })).not.toBeInTheDocument();
  });
});

describe('BrandConfigContent competitors', () => {
  it('adds a competitor typed in the last row', () => {
    renderCompetitorDomainsForm();

    typeAndEnter('Add competitor', 'Delta Sur');

    expect(screen.getByLabelText('Add website for Delta Sur')).toBeInTheDocument();
  });

  it('removes a competitor from its row', () => {
    renderCompetitorDomainsForm();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Cielo Wings' }));

    expect(screen.queryByLabelText('Add website for Cielo Wings')).not.toBeInTheDocument();
  });

  it('adds the competitors picked from Find competitors', async () => {
    const { onSave } = renderCompetitorDomainsForm(buildBrandConfig({
      tracked_brands: {
        first_party: ['Aurora Airways'],
        competitors: ['Borealis Air'] 
      } 
    }));
    await findCompetitors();

    fireEvent.click(screen.getByRole('button', { name: 'Cielo Wings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 selected' }));
    await saveConfiguration();

    expect(onSave.mock.lastCall?.[0].tracked_brands.competitors).toStrictEqual(['Borealis Air', 'Cielo Wings']);
  });
});

describe('BrandConfigContent competitor domains', () => {
  it('shows a saved competitor domain as a removable chip on load', () => {
    renderCompetitorDomainsForm();

    expect(savedCompetitorDomain('borealis-air.com', 'Borealis Air')).toBeInTheDocument();
  });

  it('offers a new-domain input for every tracked competitor', () => {
    renderCompetitorDomainsForm();

    expect(screen.getByLabelText('Add website for Borealis Air')).toBeInTheDocument();
    expect(screen.getByLabelText('Add website for Cielo Wings')).toBeInTheDocument();
  });

  it('asks for competitor brands when none are tracked', () => {
    renderCompetitorDomainsForm(buildBrandConfig({
      tracked_brands: {
        first_party: ['Aurora Airways'],
        competitors: [] 
      } 
    }));

    expect(screen.getByText(/No competitors yet/)).toBeInTheDocument();
  });

  it('shows each suggested domain as an unsaved suggestion next to its competitor', async () => {
    renderCompetitorDomainsForm();

    await findCompetitors();

    expect(suggestedCompetitorDomain('cielo-wings.example', 'Cielo Wings')).toBeInTheDocument();
    expect(suggestedCompetitorDomain('fly-cielo.example', 'Cielo Wings')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove cielo-wings.example from Cielo Wings' })).not.toBeInTheDocument();
  });

  it('disables the new-domain input once a competitor has ten domains', () => {
    renderCompetitorDomainsForm(CONFIG_AT_DOMAIN_CAP);

    expect(screen.getByLabelText('Add website for Borealis Air')).toBeDisabled();
  });
});

describe('BrandConfigContent saved competitor domains', () => {
  const STORED_AND_CIELO = {
    ...STORED_COMPETITOR_DOMAINS,
    'Cielo Wings': ['cielo-wings.example'] 
  };

  it.each([
    ['keeps the stored domains when they are not edited', addFirstPartyBrand, undefined, STORED_COMPETITOR_DOMAINS],
    ['leaves a suggested domain unsaved until the admin picks it', findCompetitorsAndEditBrands, undefined, STORED_COMPETITOR_DOMAINS],
    ['saves a suggested domain once the admin picks it', pickSuggestedCieloDomain, undefined, STORED_AND_CIELO],
    ['saves a typed domain in its canonical form', typeCieloDomainWithSchemeAndPath, undefined, STORED_AND_CIELO],
    ['removes a saved domain the admin removes', removeStoredBorealisDomain, undefined, {}],
    ['drops the domains of a competitor no longer tracked', addFirstPartyBrand, CONFIG_WITH_FORMER_RIVAL, STORED_COMPETITOR_DOMAINS],
  ])('%s', async (_name, edit, config, expected) => {
    expect(await competitorDomainsSavedAfter(edit, config)).toStrictEqual(expected);
  });
});
