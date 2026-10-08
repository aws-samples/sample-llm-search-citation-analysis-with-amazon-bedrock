import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BedrockTier } from '../../api/bedrockModels';
import {
  buildBedrockListing, buildPassedTestPayload, SONNET_4_5
} from '../../api/bedrockModels-fixtures';
import {
  mockApiGet, mockApiPost
} from '../../api/clientMock-fixtures';
import { BedrockModelsConfig } from './BedrockModelsConfig';

/** The section over a listing with `balanced` as the balanced tier, once the cards are shown. */
export async function renderBedrockModels(balanced?: BedrockTier): Promise<void> {
  mockApiGet.mockResolvedValue(buildBedrockListing(balanced));
  render(<BedrockModelsConfig />);
  await screen.findByLabelText('Model for Balanced');
}

/** The card of the tier named `name` ("Fast", "Balanced", "Deep"). */
export function tierCard(name: string) {
  return within(screen.getByRole('article', { name }));
}

/** The balanced card's button named `name`. */
export function balancedButton(name: string) {
  return tierCard('Balanced').getByRole('button', { name });
}

/** Pick the model named `modelName` for balanced and test it against `payload` (a validate answer). */
export async function pickAndTestBalanced(modelName: string, payload: unknown): Promise<void> {
  mockApiPost.mockResolvedValue(payload);
  await userEvent.selectOptions(screen.getByLabelText('Model for Balanced'), modelName);
  await userEvent.click(balancedButton('Test'));
  await tierCard('Balanced').findByRole('button', { name: 'Test' });
}

/** The section with Claude Sonnet 4.5 picked for balanced (saved: Sonnet 5.5) and passing its test. */
export async function renderPassedBalancedPick(): Promise<void> {
  await renderBedrockModels();
  await pickAndTestBalanced('Claude Sonnet 4.5', buildPassedTestPayload(SONNET_4_5));
}
