import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProvidersConfig } from './ProvidersConfig';
import { buildProvidersConfigProps } from './ProvidersConfig-fixtures';
import {
  GEMINI_AT_DEFAULT, mockModelListing, openGeminiModelEditor, typeModelId
} from './ProviderModelEditor-fixtures';
import { mockSaveProviderModel } from '../../api/providerModelsMock-fixtures';

vi.mock('../../api/providerModels', () => import('../../api/providerModelsMock-fixtures'));

describe('ProvidersConfig model editor', () => {
  it('opens the model editor of the provider whose button was pressed', async () => {
    mockModelListing([]);

    await openGeminiModelEditor();

    expect(screen.getByLabelText('Google Gemini model')).toHaveValue('gemini-3-flash-preview');
  });

  it('opens only that provider editor', async () => {
    mockModelListing([]);

    await openGeminiModelEditor();

    expect(screen.queryByLabelText('OpenAI model')).not.toBeInTheDocument();
  });

  it('closes the editor on cancel', async () => {
    mockModelListing([]);
    await openGeminiModelEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Google Gemini model')).not.toBeInTheDocument();
  });

  it('reloads the providers and closes the editor after a save', async () => {
    mockModelListing([]);
    mockSaveProviderModel.mockResolvedValue(undefined);
    const { onRefresh } = await openGeminiModelEditor();

    await typeModelId('gemini-2.5-pro', 'Google Gemini model');
    await userEvent.click(screen.getByRole('button', { name: 'Check and save' }));

    await waitFor(() => expect(screen.queryByLabelText('Google Gemini model')).not.toBeInTheDocument());
    expect(onRefresh).toHaveBeenCalledWith();
  });

  it('shows the editor to administrators only', () => {
    mockModelListing([]);

    render(<ProvidersConfig {...buildProvidersConfigProps({
      providers: [GEMINI_AT_DEFAULT],
      isAdmin: false
    })} />);

    expect(screen.queryByRole('button', { name: 'Change model' })).not.toBeInTheDocument();
  });
});
