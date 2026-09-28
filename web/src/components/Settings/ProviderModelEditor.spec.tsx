import {
  describe, expect, it, vi
} from 'vitest';
import {
  act, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  GEMINI_AT_DEFAULT,
  mockModelListing,
  modelListing,
  mountModelEditor,
  moveToGeminiWhileOpenaiListIsPending,
  OPENAI_AT_DEFAULT,
  renderModelEditor,
  suggestedModels,
  typeModelId,
} from './ProviderModelEditor-fixtures';
import {
  mockFetchProviderModels, mockSaveProviderModel, ProviderModelError
} from '../../api/providerModelsMock-fixtures';

vi.mock('../../api/providerModels', () => import('../../api/providerModelsMock-fixtures'));

const SAVE_BUTTON = { name: 'Check and save' };

describe('ProviderModelEditor model list', () => {
  it('starts from the model runs use now', async () => {
    mockModelListing([]);

    await renderModelEditor();

    expect(screen.getByLabelText('OpenAI model')).toHaveValue('gpt-5-mini');
  });

  it('turns spell checking off for model ids', async () => {
    mockModelListing([]);

    await renderModelEditor();

    expect(screen.getByLabelText('OpenAI model')).toHaveAttribute('spellcheck', 'false');
  });

  it('says it is loading the models while the list is on its way', () => {
    mockFetchProviderModels.mockReturnValue(new Promise(vi.fn()));

    mountModelEditor();

    expect(screen.getByText('Loading the models your key can use...')).toBeInTheDocument();
  });

  it('says how many models the stored key can use', async () => {
    mockModelListing(['gpt-5.2', 'o4-mini']);

    await renderModelEditor();

    expect(screen.getByText('2 models available to your key. Pick one or type an id.')).toBeInTheDocument();
  });

  it('offers the models the stored key can use as suggestions', async () => {
    mockModelListing(['gpt-5.2', 'o4-mini']);

    await renderModelEditor();

    expect(suggestedModels()).toStrictEqual(['gpt-5.2', 'o4-mini']);
  });

  it('still lets the administrator type an id when the list cannot load', async () => {
    mockFetchProviderModels.mockRejectedValue(new ProviderModelError('Could not list models: Rate limit reached'));

    await renderModelEditor();

    expect(screen.getByText('Could not list models: Rate limit reached. You can still type a model id.')).toBeInTheDocument();
  });

  it('explains a list failure that carried no message', async () => {
    mockFetchProviderModels.mockRejectedValue('offline');

    await renderModelEditor();

    expect(screen.getByText('Could not list models. You can still type a model id.')).toBeInTheDocument();
  });

  it('loads the list of the provider it now shows', async () => {
    mockModelListing([]);
    const { showProvider } = await renderModelEditor();

    showProvider(GEMINI_AT_DEFAULT);

    await waitFor(() => expect(mockFetchProviderModels).toHaveBeenLastCalledWith('gemini', expect.any(AbortSignal)));
  });

  it('ignores a list that arrives after the editor moved to another provider', async () => {
    const openaiList = await moveToGeminiWhileOpenaiListIsPending();

    await act(async () => openaiList.resolve(modelListing(['gpt-5.2', 'o4-mini'])));

    expect(suggestedModels()).toStrictEqual(['gemini-2.5-pro']);
  });

  it('ignores a list failure that arrives after the editor moved to another provider', async () => {
    const openaiList = await moveToGeminiWhileOpenaiListIsPending();

    await act(async () => openaiList.reject(new ProviderModelError('late failure')));

    expect(screen.queryByText(/late failure/)).not.toBeInTheDocument();
  });
});

describe('ProviderModelEditor saving', () => {
  it('saves the trimmed typed model and closes once the list reloaded', async () => {
    mockModelListing([]);
    mockSaveProviderModel.mockResolvedValue(undefined);
    const {
      onSaved, onClose
    } = await renderModelEditor();

    await typeModelId('  gpt-5.2 ');
    await userEvent.click(screen.getByRole('button', SAVE_BUTTON));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith());
    expect(mockSaveProviderModel).toHaveBeenCalledWith('openai', 'gpt-5.2');
    expect(onSaved).toHaveBeenCalledWith();
  });

  it('holds both buttons while the model is being checked', async () => {
    mockModelListing([]);
    mockSaveProviderModel.mockReturnValue(new Promise(vi.fn()));
    await renderModelEditor({
      ...OPENAI_AT_DEFAULT,
      model: 'gpt-5.2'
    });

    await typeModelId('o4-mini');
    await userEvent.click(screen.getByRole('button', SAVE_BUTTON));

    expect(screen.getByRole('button', { name: 'Checking...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use the default (gpt-5-mini)' })).toBeDisabled();
  });

  it('shows why the provider refused the model and stays open', async () => {
    mockModelListing([]);
    mockSaveProviderModel.mockRejectedValue(new ProviderModelError("Model check failed: Tool 'web_search_preview' is not supported"));
    const { onClose } = await renderModelEditor();

    await typeModelId('gpt-3.5-turbo');
    await userEvent.click(screen.getByRole('button', SAVE_BUTTON));

    expect(await screen.findByRole('alert')).toHaveTextContent("Model check failed: Tool 'web_search_preview' is not supported");
    expect(onClose).not.toHaveBeenCalledWith();
  });

  it('lets the administrator try again after a refusal', async () => {
    mockModelListing([]);
    mockSaveProviderModel.mockRejectedValue(new ProviderModelError('Model check failed'));
    await renderModelEditor();

    await typeModelId('gpt-3.5-turbo');
    await userEvent.click(screen.getByRole('button', SAVE_BUTTON));
    await screen.findByRole('alert');

    expect(screen.getByRole('button', SAVE_BUTTON)).toBeEnabled();
  });

  it('clears the previous refusal when trying again', async () => {
    mockModelListing([]);
    mockSaveProviderModel.mockRejectedValueOnce(new ProviderModelError('Model check failed')).mockReturnValueOnce(new Promise(vi.fn()));
    await renderModelEditor();

    await typeModelId('gpt-3.5-turbo');
    await userEvent.click(screen.getByRole('button', SAVE_BUTTON));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', SAVE_BUTTON));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a save failure that carried no message', async () => {
    mockModelListing([]);
    mockSaveProviderModel.mockRejectedValue('offline');
    await renderModelEditor();

    await typeModelId('gpt-5.2');
    await userEvent.click(screen.getByRole('button', SAVE_BUTTON));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the model');
  });

  it('shows no refusal before anything was saved', async () => {
    mockModelListing([]);

    await renderModelEditor();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ProviderModelEditor save button', () => {
  it('keeps saving disabled until the model differs from the current one', async () => {
    mockModelListing([]);

    await renderModelEditor();

    expect(screen.getByRole('button', SAVE_BUTTON)).toBeDisabled();
  });

  it.each(['', '   '])('keeps saving disabled for the blank id %j', async (model) => {
    mockModelListing([]);
    await renderModelEditor({
      ...OPENAI_AT_DEFAULT,
      model: 'gpt-5.2'
    });

    await typeModelId(model);

    expect(screen.getByRole('button', SAVE_BUTTON)).toBeDisabled();
  });

  it('enables saving for a different model', async () => {
    mockModelListing([]);
    await renderModelEditor();

    await typeModelId('gpt-5.2');

    expect(screen.getByRole('button', SAVE_BUTTON)).toBeEnabled();
  });
});

describe('ProviderModelEditor default model', () => {
  it('returns a changed provider to its default', async () => {
    mockModelListing([]);
    mockSaveProviderModel.mockResolvedValue(undefined);
    const { onClose } = await renderModelEditor({
      ...OPENAI_AT_DEFAULT,
      model: 'gpt-5.2'
    });

    await userEvent.click(screen.getByRole('button', { name: 'Use the default (gpt-5-mini)' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith());
    expect(mockSaveProviderModel).toHaveBeenCalledWith('openai', null);
  });

  it('offers no way back to the default while the default is in use', async () => {
    mockModelListing([]);

    await renderModelEditor();

    expect(screen.queryByRole('button', { name: /Use the default/ })).not.toBeInTheDocument();
  });

  it('offers no way back to a default the server did not name', async () => {
    mockModelListing([]);

    await renderModelEditor({
      ...OPENAI_AT_DEFAULT,
      model: 'gpt-5.2',
      default_model: undefined
    });

    expect(screen.queryByRole('button', { name: /Use the default/ })).not.toBeInTheDocument();
  });
});
