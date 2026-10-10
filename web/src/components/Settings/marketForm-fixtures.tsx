import userEvent from '@testing-library/user-event';
import {
  render, screen
} from '@testing-library/react';
import {
  expect, vi
} from 'vitest';
import { mockApiPost } from '../../api/clientMock-fixtures';
import type {
  Market, MarketProposal, MarketProposalRequest
} from '../../types';
import { buildMarketProposal } from '../Markets/markets-fixtures';
import { MarketForm } from './MarketForm';

export const PROPOSAL_DONE = 'Proposed by the model. Check the details, edit what is wrong, then save.';
export const NEXT_BUTTON = 'Next: describe this market';

type ProposalPostArguments = [path: string, body: { propose: MarketProposalRequest }, options: Record<string, unknown>];

/** The arguments `POST /markets {propose}` is made with for `request`. */
export function proposalPostArguments(request: MarketProposalRequest): ProposalPostArguments {
  return ['/markets', { propose: request }, {
    signal: expect.any(AbortSignal),
    acceptedJsonStatuses: [400, 502],
  }];
}

/** The form for `market` (a new one by default); returns what it submits to. */
export function renderMarketForm(market: Market | null = null) {
  const onSubmit = vi.fn();
  render(<MarketForm market={market} others={[]} saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
  return onSubmit;
}

export function chooseCountry(code: string) {
  return userEvent.selectOptions(screen.getByRole('combobox', { name: /^Country/u }), code);
}

export function chooseLanguage(code: string) {
  return userEvent.selectOptions(screen.getByRole('combobox', { name: /^Language/u }), code);
}

/** Chile and Spanish chosen on a new market's form (step 1); returns what it submits to. */
export async function setupChileanChoice() {
  const onSubmit = renderMarketForm();
  await chooseCountry('CL');
  await chooseLanguage('es');
  return onSubmit;
}

/** Step 1 done: the model is asked. */
export function describeMarket() {
  return userEvent.click(screen.getByRole('button', { name: NEXT_BUTTON }));
}

/** Chile and Spanish chosen and described, the model having answered `proposal`; returns what the form submits to. */
export async function setupDescribedChile(proposal: MarketProposal = buildMarketProposal()) {
  mockApiPost.mockResolvedValue(proposal);
  const onSubmit = await setupChileanChoice();
  await describeMarket();
  await screen.findByText(PROPOSAL_DONE);
  return onSubmit;
}

export function saveMarket() {
  return userEvent.click(screen.getByRole('button', { name: 'Save market' }));
}

export function goBack() {
  return userEvent.click(screen.getByRole('button', { name: 'Back' }));
}

/** The detail input labelled `label` ("Market id", "Currency", ...). */
export function detailField(label: string) {
  return screen.getByLabelText(new RegExp(`^${label}`, 'u'));
}

/** The proposed id replaced with `marketId` on the check step. */
export async function renameMarketId(marketId: string) {
  await userEvent.clear(detailField('Market id'));
  await userEvent.type(detailField('Market id'), marketId);
}
