import {
  describe, expect, it, vi
} from 'vitest';
import {
  screen, waitFor
} from '@testing-library/react';
import { mockSaveProviderModel } from '../../api/providerModelsMock-fixtures';
import userEvent from '@testing-library/user-event';
import {
  openGeminiModelEditor, typeModelId
} from './ProviderModelEditor-fixtures';

vi.mock('../../api/providerModels', () => import('../../api/providerModelsMock-fixtures'));

describe('ProvidersConfig model editor', () => {
  it('opens the model editor of the provider whose button was pressed', async () => {
    await openGeminiModelEditor();

    expect(screen.getByLabelText('Google Gemini model')).toHaveValue('gemini-3-flash-preview');
  });

  it('opens only that provider editor', async () => {
    await openGeminiModelEditor();

    expect(screen.queryByLabelText('OpenAI model')).not.toBeInTheDocument();
  });

  it('closes the editor on cancel', async () => {
    await openGeminiModelEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Google Gemini model')).not.toBeInTheDocument();
  });

  it('reloads the providers and closes the editor after a save', async () => {
    mockSaveProviderModel.mockResolvedValue(undefined);
    const { onRefresh } = await openGeminiModelEditor();

    await typeModelId('gemini-2.5-pro', 'Google Gemini model');
    await userEvent.click(screen.getByRole('button', { name: 'Check and save' }));

    await waitFor(() => expect(screen.queryByLabelText('Google Gemini model')).not.toBeInTheDocument());
    expect(onRefresh).toHaveBeenCalledWith();
  });
});
