import {
  render, screen, within
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import userEvent from '@testing-library/user-event';
import { BedrockModelsConfig } from './BedrockModelsConfig';
import {
  balancedButton, pickAndTestBalanced, renderBedrockModels, renderPassedBalancedPick, tierCard
} from './BedrockModelsConfig-fixtures';
import {
  mockApiGet, mockApiPut
} from '../../api/clientMock-fixtures';
import {
  BALANCED_AT_DEFAULT,
  BALANCED_ON_SONNET_4_5,
  BedrockOutageError,
  buildBedrockListing,
  buildFailedTestPayload,
  buildPassedTestPayload,
  RESTORE_BALANCED_DEFAULT_REQUEST,
  SONNET_4_5,
} from '../../api/bedrockModels-fixtures';
import type { BedrockFailureReason } from '../../api/bedrockModels';
import { formatDateOnly } from '../../formatting/dateFormatter';

vi.mock('../../api/client', () => import('../../api/clientMock-fixtures'));

const SONNET_4_5_NAME = 'Claude Sonnet 4.5';

describe('BedrockModelsConfig loading', () => {
  it('shows tier-card placeholders while the first listing loads', () => {
    mockApiGet.mockReturnValue(new Promise(vi.fn()));

    render(<BedrockModelsConfig />);

    expect(screen.getByText('Loading Bedrock models').closest('output')).toHaveAttribute('aria-busy', 'true');
  });

  it('explains why the listing failed', async () => {
    mockApiGet.mockRejectedValue(new BedrockOutageError('HTTP 500: Internal Server Error'));

    render(<BedrockModelsConfig />);

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500: Internal Server Error');
  });

  it('shows the tiers once a retry succeeds', async () => {
    mockApiGet.mockResolvedValue(buildBedrockListing()).mockRejectedValueOnce(new BedrockOutageError('offline'));
    render(<BedrockModelsConfig />);

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findAllByRole('article')).toHaveLength(3);
  });
});

describe('BedrockModelsConfig tier cards', () => {
  it.each([
    ['Fast', 'Used for page summaries, brand extraction, Content Studio and research evaluation.'],
    ['Balanced', 'Used for analysis and recommendations and research planning.'],
    ['Deep', 'Not used by default'],
  ])('says what the %s tier is used for', async (tier, use) => {
    await renderBedrockModels();

    expect(tierCard(tier).getByText(use)).toBeInTheDocument();
  });

  it('marks a tier on its default model', async () => {
    await renderBedrockModels();

    expect(tierCard('Fast').getByText('Default')).toBeInTheDocument();
  });

  it('dates the change of a tier off its default model', async () => {
    await renderBedrockModels(BALANCED_ON_SONNET_4_5);

    expect(tierCard('Balanced').getByText(`Changed ${formatDateOnly(BALANCED_ON_SONNET_4_5.model_updated_at)}`)).toBeInTheDocument();
  });

  it.each([
    ['Fast', 'Adaptive thinking'],
    ['Balanced', 'Thinking budget'],
  ])('shows how the app talks to the %s model', async (tier, style) => {
    await renderBedrockModels(BALANCED_ON_SONNET_4_5);

    expect(tierCard(tier).getByText(style)).toBeInTheDocument();
  });

  it('shows no request style when it is not known', async () => {
    await renderBedrockModels();

    expect(tierCard('Deep').queryByText(/thinking/i)).not.toBeInTheDocument();
  });

  it('selects the model the tier runs on now', async () => {
    await renderBedrockModels(BALANCED_ON_SONNET_4_5);

    expect(screen.getByLabelText('Model for Balanced')).toHaveDisplayValue(SONNET_4_5_NAME);
  });
});

describe('BedrockModelsConfig testing', () => {
  it('reports a passing test with its latency and quota', async () => {
    await renderBedrockModels();

    await pickAndTestBalanced(SONNET_4_5_NAME, buildPassedTestPayload(SONNET_4_5));

    expect(tierCard('Balanced').getByText('Works · 930 ms · 6M tokens/min')).toBeInTheDocument();
  });

  it('says the quota was not reported when a passing test carries none', async () => {
    await renderBedrockModels();

    await pickAndTestBalanced(SONNET_4_5_NAME, buildPassedTestPayload(SONNET_4_5, null));

    expect(tierCard('Balanced').getByText('Works · 930 ms · quota not reported')).toBeInTheDocument();
  });

  it.each<[BedrockFailureReason, string]>([
    ['not_subscribed', "Not subscribed in this account. Bedrock subscribes a model the first time it's invoked by a role "
      + 'that may subscribe; deploy the stack with this model in the list, or invoke it once from the console.'],
    ['access_denied', 'Access denied for this model.'],
    ['no_capacity', "This account's quota for this model is 0 tokens per minute, so it can't be used yet. "
      + 'Nothing to do but wait for the quota to be raised.'],
    ['throttled', 'The model is at capacity right now (throttled). Try the test again later.'],
    // An unsupported model's sentence carries the server's reason after it.
    ['unsupported', "This model doesn't accept the requests the app sends. Bedrock timed out"],
    ['unavailable', 'This model is no longer available.'],
    ['error', 'Bedrock timed out'],
  ])('explains a %s failure in plain words', async (reason, sentence) => {
    await renderBedrockModels();

    await pickAndTestBalanced(SONNET_4_5_NAME, buildFailedTestPayload(SONNET_4_5, reason, 'Bedrock timed out'));

    expect(tierCard('Balanced').getByText(sentence)).toBeInTheDocument();
  });

  it('clears the result when another model is picked', async () => {
    await renderPassedBalancedPick();

    await userEvent.selectOptions(screen.getByLabelText('Model for Balanced'), 'Claude Opus 5.5');

    expect(tierCard('Balanced').queryByText(/^Works/)).not.toBeInTheDocument();
  });
});

describe('BedrockModelsConfig save button', () => {
  it('is disabled while the saved model is picked', async () => {
    await renderBedrockModels();

    expect(balancedButton('Save')).toBeDisabled();
  });

  it('stays disabled for a changed model that was not tested', async () => {
    await renderBedrockModels();

    await userEvent.selectOptions(screen.getByLabelText('Model for Balanced'), SONNET_4_5_NAME);

    expect(balancedButton('Save')).toBeDisabled();
  });

  it('stays disabled for a changed model that failed its test', async () => {
    await renderBedrockModels();

    await pickAndTestBalanced(SONNET_4_5_NAME, buildFailedTestPayload(SONNET_4_5, 'throttled'));

    expect(balancedButton('Save')).toBeDisabled();
  });

  it('is enabled once the changed model passed its test', async () => {
    await renderBedrockModels();

    await pickAndTestBalanced(SONNET_4_5_NAME, buildPassedTestPayload(SONNET_4_5));

    expect(balancedButton('Save')).toBeEnabled();
  });
});

describe('BedrockModelsConfig saving', () => {
  it('shows the stored model on the card and confirms the save', async () => {
    await renderPassedBalancedPick();
    mockApiPut.mockResolvedValue(BALANCED_ON_SONNET_4_5);

    await userEvent.click(balancedButton('Save'));

    expect(await tierCard('Balanced').findByText('Saved')).toBeInTheDocument();
    expect(tierCard('Balanced').getByText(/^Current model:/)).toHaveTextContent(`Current model: ${SONNET_4_5_NAME}`);
  });

  it('shows the details of a refused save on the card', async () => {
    await renderPassedBalancedPick();
    mockApiPut.mockResolvedValue({
      error: 'Model check failed',
      details: 'The model is at capacity right now (throttled).',
      reason: 'throttled',
    });

    await userEvent.click(balancedButton('Save'));

    expect(await tierCard('Balanced').findByRole('alert')).toHaveTextContent('The model is at capacity right now (throttled).');
  });
});

describe('BedrockModelsConfig default model', () => {
  it('offers no way back for a tier on its default model', async () => {
    await renderBedrockModels();

    expect(tierCard('Balanced').queryByRole('button', { name: 'Use default' })).not.toBeInTheDocument();
  });

  it('asks before returning a tier to its default model', async () => {
    await renderBedrockModels(BALANCED_ON_SONNET_4_5);

    await userEvent.click(balancedButton('Use default'));

    expect(screen.getByText('Balanced goes back to Claude Sonnet 5.5. The default needs no test.')).toBeInTheDocument();
  });

  it('returns the tier to its default model once confirmed', async () => {
    await renderBedrockModels(BALANCED_ON_SONNET_4_5);
    mockApiPut.mockResolvedValue(BALANCED_AT_DEFAULT);
    await userEvent.click(balancedButton('Use default'));

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Use default' }));

    expect(await tierCard('Balanced').findByText('Default')).toBeInTheDocument();
    expect(mockApiPut).toHaveBeenCalledWith(...RESTORE_BALANCED_DEFAULT_REQUEST);
  });

  it('leaves the tier alone when the confirmation is cancelled', async () => {
    await renderBedrockModels(BALANCED_ON_SONNET_4_5);
    await userEvent.click(balancedButton('Use default'));

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockApiPut.mock.calls).toHaveLength(0);
  });
});
