import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { mockApiPost } from '../../api/clientMock-fixtures';
import {
  BRAZIL, buildMarket, buildMarketProposal, CHILE, SANTIAGO
} from '../Markets/markets-fixtures';
import {
  chooseCountry, describeMarket, detailField, goBack, NEXT_BUTTON, PROPOSAL_DONE, proposalPostArguments, renameMarketId,
  renderMarketForm, saveMarket, setupChileanChoice, setupDescribedChile
} from './marketForm-fixtures';

vi.mock('../../api/client', () => import('../../api/clientMock-fixtures'));

const MODEL_FAILURE = 'The model could not describe this market; fill the fields in by hand';

describe('MarketForm step 1, the choice', () => {
  it('starts with the choice alone: no details and nothing to save yet', () => {
    renderMarketForm();

    expect(screen.getByRole('heading', { name: 'Step 1 of 2 · Where keywords of this market are asked from' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Market id/u)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save market' })).not.toBeInTheDocument();
  });

  it('cannot go on until a country and a language are chosen', async () => {
    renderMarketForm();

    await chooseCountry('CL');

    expect(screen.getByRole('button', { name: NEXT_BUTTON })).toBeDisabled();
  });

  it('asks the model about the chosen country, language and city', async () => {
    mockApiPost.mockResolvedValue(buildMarketProposal());
    await setupChileanChoice();
    await userEvent.type(screen.getByLabelText('City'), 'Santiago');

    await describeMarket();

    expect(mockApiPost).toHaveBeenCalledWith(...proposalPostArguments({
      country: 'CL',
      language: 'es',
      city: 'Santiago',
    }));
  });

  it('describes the market, rather than saving, when the choice is submitted with Enter', async () => {
    mockApiPost.mockResolvedValue(buildMarketProposal());
    const onSubmit = await setupChileanChoice();

    await userEvent.type(screen.getByLabelText('City'), '{Enter}');

    expect(mockApiPost).toHaveBeenCalledWith(...proposalPostArguments({
      country: 'CL',
      language: 'es',
    }));
    expect(onSubmit).not.toHaveBeenCalledWith(expect.anything());
  });

  it('says the model is being asked and takes no changes meanwhile', async () => {
    mockApiPost.mockReturnValue(new Promise<never>(vi.fn()));
    await setupChileanChoice();

    await describeMarket();

    expect(screen.getByRole('button', { name: 'Describing…' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /^Country/u })).toBeDisabled();
    expect(screen.getByText(/Asking the model for the currency, time zone, local competitors and brand names/u)).toBeInTheDocument();
  });
});

describe('MarketForm step 2, the check', () => {
  it('shows the details the model proposed', async () => {
    await setupDescribedChile();

    expect(screen.getByRole('heading', { name: 'Step 2 of 2 · Check the details, then save' })).toBeInTheDocument();
    expect(detailField('Currency')).toHaveValue('CLP');
    expect(detailField('Time zone')).toHaveValue('America/Santiago');
    expect(detailField('Extra local competitors')).toHaveValue('Sky Airline\nJetSMART');
  });

  it('shows the city the model picked when none was given', async () => {
    await setupDescribedChile();

    expect(detailField('City')).toHaveValue('Santiago');
  });

  it('saves the proposed market once confirmed', async () => {
    const onSubmit = await setupDescribedChile();

    await saveMarket();

    expect(onSubmit).toHaveBeenCalledWith(SANTIAGO);
  });

  it('saves the details as edited after the proposal', async () => {
    const onSubmit = await setupDescribedChile();
    await renameMarketId('cl-santiago');

    await saveMarket();

    expect(onSubmit).toHaveBeenCalledWith({
      ...SANTIAGO,
      market_id: 'cl-santiago',
    });
  });

  it('warns when the proposed id is already configured', async () => {
    await setupDescribedChile(buildMarketProposal({ market_id_taken: true }));

    expect(screen.getByRole('alert')).toHaveTextContent("market_id 'cl-es' is already configured; change it below");
  });

  it('returns to the same details, edits kept, when the choice is left as it was', async () => {
    await setupDescribedChile();
    await renameMarketId('cl-santiago');

    await goBack();
    await describeMarket();

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(detailField('Market id')).toHaveValue('cl-santiago');
  });

  it('describes a changed choice afresh', async () => {
    await setupDescribedChile();
    mockApiPost.mockResolvedValue(buildMarketProposal({ market: BRAZIL }));

    await goBack();
    await chooseCountry('BR');
    await describeMarket();

    await screen.findByText(PROPOSAL_DONE);
    expect(mockApiPost).toHaveBeenLastCalledWith(...proposalPostArguments({
      country: 'BR',
      language: 'es',
    }));
    expect(detailField('Currency')).toHaveValue('BRL');
  });

  it('asks the model again on request', async () => {
    await setupDescribedChile();
    mockApiPost.mockResolvedValue(buildMarketProposal({ market: buildMarket({ currency: 'USD' }) }));

    await userEvent.click(screen.getByRole('button', { name: 'Describe again' }));

    await screen.findByDisplayValue('USD');
    expect(mockApiPost).toHaveBeenCalledTimes(2);
  });

  it('falls back to the details the choice implies when the model cannot describe the market', async () => {
    mockApiPost.mockResolvedValue({ error: MODEL_FAILURE });
    await setupChileanChoice();

    await describeMarket();

    expect(await screen.findByRole('alert')).toHaveTextContent(MODEL_FAILURE);
    expect(detailField('Country name')).toHaveValue('Chile');
    expect(detailField('Language name')).toHaveValue('Spanish');
    expect(detailField('Currency')).toHaveValue('');
  });

  it('refuses an incomplete market before saving', async () => {
    mockApiPost.mockResolvedValue({ error: MODEL_FAILURE });
    const onSubmit = await setupChileanChoice();
    await describeMarket();
    await screen.findByRole('alert');

    await saveMarket();

    expect(screen.getByText('market_id must be 2-32 lower-case letters, digits or dashes')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalledWith(expect.anything());
  });
});

describe('MarketForm for an existing market', () => {
  it('shows the details straight away, the id fixed, with no steps to take', () => {
    renderMarketForm(CHILE);
    const marketId = detailField('Market id');

    expect(marketId).toBeDisabled();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('edits the city in the details', async () => {
    const onSubmit = renderMarketForm(CHILE);
    await userEvent.type(detailField('City'), 'Santiago');

    await saveMarket();

    expect(onSubmit).toHaveBeenCalledWith(buildMarket({ city: 'Santiago' }));
  });
});
