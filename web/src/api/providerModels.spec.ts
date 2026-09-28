import {
  describe, expect, it, vi
} from 'vitest';
import {
  fetchProviderModels, ProviderModelError, saveProviderModel
} from './providerModels';
import {
  mockApiGet, mockApiPut
} from './clientMock-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

const LISTING = {
  id: 'openai',
  models: ['gpt-5.2', 'gpt-5-mini'],
  model: 'gpt-5-mini',
  default_model: 'gpt-5-mini',
  model_configurable: true,
};

describe('fetchProviderModels', () => {
  it('returns the listing the server answered with', async () => {
    mockApiGet.mockResolvedValue(LISTING);

    await expect(fetchProviderModels('openai')).resolves.toStrictEqual(LISTING);
  });

  it('asks for the provider models and keeps refusal bodies readable', async () => {
    mockApiGet.mockResolvedValue(LISTING);
    const controller = new AbortController();

    await fetchProviderModels('openai', controller.signal);

    expect(mockApiGet).toHaveBeenCalledWith('/providers/openai/models', {
      signal: controller.signal,
      acceptedJsonStatuses: [400, 502],
    });
  });

  it('throws the refusal together with the provider reason', async () => {
    mockApiGet.mockResolvedValue({
      error: 'Could not list models',
      details: 'Rate limit reached' 
    });

    await expect(fetchProviderModels('openai')).rejects.toThrow(ProviderModelError);
    await expect(fetchProviderModels('openai')).rejects.toThrow('Could not list models: Rate limit reached');
  });

  it('throws the bare refusal when the server gives no reason', async () => {
    mockApiGet.mockResolvedValue({ error: 'Configure an API key before choosing a model' });

    await expect(fetchProviderModels('gemini')).rejects.toThrow('Configure an API key before choosing a model');
  });

  it('names its errors for the logs', async () => {
    mockApiGet.mockResolvedValue({ error: 'Could not list models' });

    await expect(fetchProviderModels('gemini')).rejects.toHaveProperty('name', 'ProviderModelError');
  });

  it('ignores a reason that is not text', async () => {
    mockApiGet.mockResolvedValue({
      error: 'Could not list models',
      details: 42
    });

    await expect(fetchProviderModels('openai')).rejects.toThrow(/^Could not list models$/);
  });

  it.each([
    ['nothing', null],
    ['no model', {
      models: [],
      default_model: 'gpt-5-mini'
    }],
    ['no default model', {
      models: [],
      model: 'gpt-5-mini'
    }],
  ])('rejects a listing with %s', async (_label, payload) => {
    mockApiGet.mockResolvedValue(payload);

    await expect(fetchProviderModels('openai')).rejects.toThrow(ProviderModelError);
  });

  it('rejects a listing holding a non-string model id', async () => {
    mockApiGet.mockResolvedValue({
      ...LISTING,
      models: ['gpt-5.2', 42] 
    });

    await expect(fetchProviderModels('openai')).rejects.toThrow('Provider API returned an invalid model list');
  });
});

describe('saveProviderModel', () => {
  it('puts the chosen model on the provider', async () => {
    mockApiPut.mockResolvedValue({ id: 'gemini' });

    await saveProviderModel('gemini', 'gemini-2.5-pro');

    expect(mockApiPut).toHaveBeenCalledWith('/providers/gemini', { model: 'gemini-2.5-pro' }, { acceptedJsonStatuses: [400] });
  });

  it('sends null to return the provider to its default', async () => {
    mockApiPut.mockResolvedValue({ id: 'openai' });

    await saveProviderModel('openai', null);

    expect(mockApiPut).toHaveBeenCalledWith('/providers/openai', { model: null }, { acceptedJsonStatuses: [400] });
  });

  it('throws the model-check refusal with the provider reason', async () => {
    mockApiPut.mockResolvedValue({
      error: 'Model check failed',
      details: "Tool 'web_search_preview' is not supported" 
    });

    await expect(saveProviderModel('openai', 'gpt-3.5-turbo')).rejects.toThrow(
      "Model check failed: Tool 'web_search_preview' is not supported"
    );
  });
});
