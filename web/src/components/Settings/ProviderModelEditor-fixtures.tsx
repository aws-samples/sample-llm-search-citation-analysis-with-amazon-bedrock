import { vi } from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import type { ProviderModelListing } from '../../api/providerModels';
import { ProviderModelEditor } from './ProviderModelEditor';
import { ProvidersConfig } from './ProvidersConfig';
import {
  buildProviderConfig, buildProvidersConfigProps
} from './ProvidersConfig-fixtures';
import { mockFetchProviderModels } from '../../api/providerModelsMock-fixtures';
import { createDeferredValue } from '../../hooks/useAlerts-fixtures';

/** OpenAI answering with its default model. */
export const OPENAI_AT_DEFAULT = buildProviderConfig({
  id: 'openai',
  name: 'OpenAI',
  model: 'gpt-5-mini',
  default_model: 'gpt-5-mini',
  model_configurable: true,
});

/** Gemini answering with its default model. */
export const GEMINI_AT_DEFAULT = buildProviderConfig({
  id: 'gemini',
  name: 'Google Gemini',
  model: 'gemini-3-flash-preview',
  default_model: 'gemini-3-flash-preview',
  model_configurable: true,
});

/** Mount the editor without waiting for its model list; returns the callbacks and `rerender`. */
export function mountModelEditor(provider: ProviderConfig = OPENAI_AT_DEFAULT) {
  const onSaved = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const onClose = vi.fn<() => void>();
  const { rerender } = render(<ProviderModelEditor provider={provider} onSaved={onSaved} onClose={onClose} />);
  return {
    onSaved,
    onClose,
    showProvider: (next: ProviderConfig) => rerender(<ProviderModelEditor provider={next} onSaved={onSaved} onClose={onClose} />),
  };
}

/** Mount the editor and wait until its model list settled; returns the callbacks. */
export async function renderModelEditor(provider: ProviderConfig = OPENAI_AT_DEFAULT) {
  const mounted = mountModelEditor(provider);
  // Let the model list settle so no state update lands after the test.
  await screen.findByText(/available to your key|You can still type a model id/);
  return mounted;
}

export function modelListing(models: string[]): ProviderModelListing {
  return {
    models,
    model: 'gpt-5-mini',
    default_model: 'gpt-5-mini',
  };
}

/** The models endpoint answers with `models`. */
export function mockModelListing(models: string[]): void {
  mockFetchProviderModels.mockResolvedValue(modelListing(models));
}

/** Replace the model field's text with `model`. */
export async function typeModelId(model: string, label = 'OpenAI model'): Promise<void> {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  if (model !== '') await userEvent.type(input, model);
}

export function suggestedModels(): (string | null)[] {
  return [...document.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'));
}


/**
 * The providers panel with OpenAI and Gemini, Gemini's model editor opened on
 * an empty model list and settled; returns the props.
 */
export async function openGeminiModelEditor() {
  mockModelListing([]);
  const props = buildProvidersConfigProps({ providers: [OPENAI_AT_DEFAULT, GEMINI_AT_DEFAULT] });
  render(<ProvidersConfig {...props} />);
  await userEvent.click(screen.getAllByRole('button', { name: 'Change model' })[1]);
  await screen.findByText(/available to your key/);
  return props;
}


/**
 * Mount the editor on OpenAI with its list still pending, move it to Gemini
 * and wait for Gemini's list; returns OpenAI's pending list to settle late.
 */
export async function moveToGeminiWhileOpenaiListIsPending() {
  const openaiList = createDeferredValue<ProviderModelListing>();
  mockFetchProviderModels.mockReturnValueOnce(openaiList.promise).mockResolvedValueOnce(modelListing(['gemini-2.5-pro']));
  const { showProvider } = mountModelEditor();
  showProvider(GEMINI_AT_DEFAULT);
  await screen.findByText('1 models available to your key. Pick one or type an id.');
  return openaiList;
}
