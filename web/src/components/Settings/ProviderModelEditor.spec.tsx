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
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import {
  mockFetchProviderModels, mockSaveProviderModel, ProviderModelError
} from '../../api/providerModelsMock-fixtures';

vi.mock('../../api/providerModels', () => import('../../api/providerModelsMock-fixtures'));

const SAVE_BUTTON = { name: 'Check and save' };

const OPENAI_ON_GPT_5_2 = {
  ...OPENAI_AT_DEFAULT,
  model: 'gpt-5.2'
};

function renderUnlistedModelEditor(provider?: ProviderConfig) {
  mockModelListing([]);
  return renderModelEditor(provider);
}

async function renderAndSubmitModel(model: string, provider?: ProviderConfig) {
  const mounted = await renderUnlistedModelEditor(provider);
  await typeModelId(model);
  await userEvent.click(screen.getByRole('button', SAVE_BUTTON));
  return mounted;
}

describe('ProviderModelEditor model list', () => {
  it('starts from the model runs use now', async () => {
    await renderUnlistedModelEditor();

    expect(screen.getByLabelText('OpenAI model')).toHaveValue('gpt-5-mini');
  });

  it('turns spell checking off for model ids', async () => {
    await renderUnlistedModelEditor();

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
    const { showProvider } = await renderUnlistedModelEditor();

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
    mockSaveProviderModel.mockResolvedValue(undefined);
    const {
      onSaved, onClose
    } = await renderAndSubmitModel('  gpt-5.2 ');

    await waitFor(() => expect(onClose).toHaveBeenCalledWith());
    expect(mockSaveProviderModel).toHaveBeenCalledWith('openai', 'gpt-5.2');
    expect(onSaved).toHaveBeenCalledWith();
  });

  it('holds both buttons while the model is being checked', async () => {
    mockSaveProviderModel.mockReturnValue(new Promise(vi.fn()));
    await renderAndSubmitModel('o4-mini', OPENAI_ON_GPT_5_2);

    expect(screen.getByRole('button', { name: 'Checking...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use the default (gpt-5-mini)' })).toBeDisabled();
  });

  it('shows why the provider refused the model and stays open', async () => {
    mockSaveProviderModel.mockRejectedValue(new ProviderModelError("Model check failed: Tool 'web_search_preview' is not supported"));
    const { onClose } = await renderAndSubmitModel('gpt-3.5-turbo');

    expect(await screen.findByRole('alert')).toHaveTextContent("Model check failed: Tool 'web_search_preview' is not supported");
    expect(onClose).not.toHaveBeenCalledWith();
  });

  it('lets the administrator try again after a refusal', async () => {
    mockSaveProviderModel.mockRejectedValue(new ProviderModelError('Model check failed'));
    await renderAndSubmitModel('gpt-3.5-turbo');
    await screen.findByRole('alert');

    expect(screen.getByRole('button', SAVE_BUTTON)).toBeEnabled();
  });

  it('clears the previous refusal when trying again', async () => {
    mockSaveProviderModel.mockRejectedValueOnce(new ProviderModelError('Model check failed')).mockReturnValueOnce(new Promise(vi.fn()));
    await renderAndSubmitModel('gpt-3.5-turbo');
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', SAVE_BUTTON));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a save failure that carried no message', async () => {
    mockSaveProviderModel.mockRejectedValue('offline');
    await renderAndSubmitModel('gpt-5.2');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the model');
  });

  it('shows no refusal before anything was saved', async () => {
    await renderUnlistedModelEditor();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ProviderModelEditor save button', () => {
  it('keeps saving disabled until the model differs from the current one', async () => {
    await renderUnlistedModelEditor();

    expect(screen.getByRole('button', SAVE_BUTTON)).toBeDisabled();
  });

  it.each(['', '   '])('keeps saving disabled for the blank id %j', async (model) => {
    await renderUnlistedModelEditor(OPENAI_ON_GPT_5_2);

    await typeModelId(model);

    expect(screen.getByRole('button', SAVE_BUTTON)).toBeDisabled();
  });

  it('enables saving for a different model', async () => {
    await renderUnlistedModelEditor();

    await typeModelId('gpt-5.2');

    expect(screen.getByRole('button', SAVE_BUTTON)).toBeEnabled();
  });
});

describe('ProviderModelEditor default model', () => {
  it('returns a changed provider to its default', async () => {
    mockSaveProviderModel.mockResolvedValue(undefined);
    const { onClose } = await renderUnlistedModelEditor(OPENAI_ON_GPT_5_2);

    await userEvent.click(screen.getByRole('button', { name: 'Use the default (gpt-5-mini)' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith());
    expect(mockSaveProviderModel).toHaveBeenCalledWith('openai', null);
  });

  it.each<[condition: string, provider: ProviderConfig]>([
    ['while the default is in use', OPENAI_AT_DEFAULT],
    ['to a default the server did not name', {
      ...OPENAI_ON_GPT_5_2,
      default_model: undefined
    }],
  ])('offers no way back %s', async (_condition, provider) => {
    await renderUnlistedModelEditor(provider);

    expect(screen.queryByRole('button', { name: /Use the default/ })).not.toBeInTheDocument();
  });
});
