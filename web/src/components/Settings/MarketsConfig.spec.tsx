import userEvent from '@testing-library/user-event';
import {
  screen, within
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { mockApiPost } from '../../api/clientMock-fixtures';
import type { MarketsController } from '../../hooks/useMarkets';
import {
  MarketsConfig, saveProblem
} from './MarketsConfig';
import {
  BRAZIL, buildMarket, buildMarketProposal, buildMarketSelectionMock, CHILE, renderWithMarketSelection
} from '../Markets/markets-fixtures';

vi.mock('../../api/client', () => import('../../api/clientMock-fixtures'));

/** The section for an admin or not, over `catalog` (Chile and Brazil by default); returns the catalog it reads. */
function renderMarketsConfig(isAdmin: boolean, catalog: Partial<MarketsController> = {}) {
  const selection = buildMarketSelectionMock({ catalog });
  renderWithMarketSelection(<MarketsConfig isAdmin={isAdmin} />, selection);
  return selection.catalog;
}

/** The admin's section over Chile and Brazil after clicking `button`; returns the catalog it reads. */
async function renderAdminSectionAndClick(button: string) {
  const catalog = renderMarketsConfig(true);
  await userEvent.click(screen.getByRole('button', { name: button }));
  return catalog;
}

describe('MarketsConfig', () => {
  it('lists each market with its place, language, currency and time zone', () => {
    renderMarketsConfig(false);

    expect(screen.getByText('Chile (CL) · Spanish (es-CL) · CLP · America/Santiago')).toBeInTheDocument();
  });

  it('shows the extra competitors and local brand names of a market', () => {
    renderMarketsConfig(false, {
      markets: [buildMarket({
        competitors: ['Sky Airline'],
        first_party_aliases: ['Altiplano Chile'],
      })],
    });

    expect(screen.getByText('Competitors: Sky Airline · Local brand names: Altiplano Chile')).toBeInTheDocument();
  });

  it.each([
    ['explains the empty list', {markets: [],}, /No markets yet/u],
    ['holds a placeholder before the first read', {
      markets: [],
      loaded: false,
      loading: true,
    }, 'Loading markets'],
  ])('%s', (_description, catalog, text) => {
    renderMarketsConfig(false, catalog);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('offers no editing to non-admins', () => {
    renderMarketsConfig(false);

    expect(screen.queryByRole('button', { name: 'Add market' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Chile (Spanish)' })).not.toBeInTheDocument();
    expect(screen.getByText('Only administrators can change markets.')).toBeInTheDocument();
  });

  it('saves the list with a new market appended once its proposal is confirmed', async () => {
    mockApiPost.mockResolvedValue(buildMarketProposal({ market: BRAZIL }));
    const catalog = renderMarketsConfig(true, { markets: [CHILE] });
    await userEvent.click(screen.getByRole('button', { name: 'Add market' }));
    const form = within(screen.getByRole('form', { name: 'Add market' }));
    await userEvent.selectOptions(form.getByRole('combobox', { name: /^Country/u }), 'BR');
    await userEvent.selectOptions(form.getByRole('combobox', { name: /^Language/u }), 'pt');
    await userEvent.click(form.getByRole('button', { name: 'Next: describe this market' }));
    await form.findByText('Proposed by the model. Check the details, edit what is wrong, then save.');

    await userEvent.click(form.getByRole('button', { name: 'Save market' }));

    expect(catalog.save).toHaveBeenCalledWith([CHILE, BRAZIL]);
  });

  it('refuses an incomplete market before saving', async () => {
    mockApiPost.mockResolvedValue({ error: 'The model could not describe this market; fill the fields in by hand' });
    const catalog = await renderAdminSectionAndClick('Add market');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Country/u }), 'MX');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Language/u }), 'es');
    await userEvent.click(screen.getByRole('button', { name: 'Next: describe this market' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Save market' }));

    expect(screen.getByText('market_id must be 2-32 lower-case letters, digits or dashes')).toBeInTheDocument();
    expect(catalog.save).not.toHaveBeenCalledWith(expect.anything());
  });

  it('saves an edited market in its place', async () => {
    const catalog = await renderAdminSectionAndClick('Edit Chile (Spanish)');

    await userEvent.type(screen.getByLabelText(/City/u), 'Santiago');
    await userEvent.click(screen.getByRole('button', { name: 'Save market' }));

    expect(catalog.save).toHaveBeenCalledWith([buildMarket({ city: 'Santiago' }), BRAZIL]);
  });

  it('keeps the id of an edited market fixed', async () => {
    await renderAdminSectionAndClick('Edit Chile (Spanish)');

    expect(screen.getByLabelText(/Market id/u)).toBeDisabled();
  });

  it('saves the list without a removed market once confirmed', async () => {
    const catalog = await renderAdminSectionAndClick('Remove Brazil (Portuguese)');

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(catalog.save).toHaveBeenCalledWith([CHILE]);
  });

  it('says which markets keywords still use when a removal is refused', () => {
    renderMarketsConfig(true, {
      saveOutcome: {
        status: 'failed',
        message: 'Markets still used by keywords',
        inUse: ['br-pt'],
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Keywords still use Brazil (Portuguese). Move those keywords to another market or delete them first.'
    );
  });
});

describe('saveProblem', () => {
  it('passes a validation refusal through', () => {
    expect(saveProblem({
      status: 'failed',
      message: 'Market 2: currency is not valid',
      inUse: [],
    }, [CHILE])).toBe('Market 2: currency is not valid');
  });

  it('has nothing to say about a save that did not fail', () => {
    expect(saveProblem({ status: 'saved' }, [CHILE])).toBeNull();
  });
});
