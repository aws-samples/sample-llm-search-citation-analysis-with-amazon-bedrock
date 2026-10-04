import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useProviderConfig } from './useProviderConfig';
import {
  countProviderListRequests, mockProviders, renderLoadedProviderConfig
} from './useProviderConfig-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

describe('useProviderConfig', () => {
  it('returns loading true initially', () => {
    // Create a promise that never resolves
    mockAuthenticatedFetch.mockImplementation(() => new Promise(vi.fn()));

    const { result } = renderHook(() => useProviderConfig());

    expect(result.current.loading).toBe(true);
  });

  it('fetches and returns providers on mount', async () => {
    const { result } = await renderLoadedProviderConfig();

    expect(result.current.providers).toStrictEqual(mockProviders);
    expect(result.current.error).toBeNull();
  });

  it('sets error and returns default providers when fetch fails', async () => {
    const { result } = await renderLoadedProviderConfig({ shouldFail: true });

    expect(result.current.error).toBe('Unable to connect to provider service');
    expect(result.current.providers.map((provider) => provider.id)).toStrictEqual([
      'openai', 'perplexity', 'gemini', 'claude',
    ]);
  });

  it('falls back to enabled, unconfigured providers with no stored key when fetch fails', async () => {
    const { result } = await renderLoadedProviderConfig({ shouldFail: true });

    expect(result.current.providers.map((provider) => [
      provider.id, provider.model, provider.enabled, provider.configured, provider.masked_key, provider.last_updated,
    ])).toStrictEqual([
      ['openai', 'gpt-5-mini', true, false, null, null],
      ['perplexity', 'sonar', true, false, null, null],
      ['gemini', 'gemini-3-flash-preview', true, false, null, null],
      ['claude', 'claude-sonnet-4-5', true, false, null, null],
    ]);
  });

  it.each([
    {
      name: 'returns true when updateProvider succeeds',
      options: {},
      expected: true,
    },
    {
      name: 'returns false when updateProvider fails',
      options: { updateSuccess: false },
      expected: false,
    },
  ])('$name', async ({
    options, expected 
  }) => {
    const { result } = await renderLoadedProviderConfig(options);

    const updated = await act(() => result.current.updateProvider('openai', { enabled: false }));

    expect(updated).toBe(expected);
  });

  it('sends correct payload when updating provider with api_key', async () => {
    const { result } = await renderLoadedProviderConfig();

    await act(() => result.current.updateProvider('openai', { api_key: 'new-key-123' }));

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/providers/openai',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ api_key: 'new-key-123' }),
      })
    );
  });

  it('refreshes providers after successful update', async () => {
    const { result } = await renderLoadedProviderConfig();
    const initialCallCount = countProviderListRequests();

    await act(() => result.current.updateProvider('openai', { enabled: false }));

    expect(countProviderListRequests()).toBeGreaterThan(initialCallCount);
  });

  it('refetches providers when refreshProviders called', async () => {
    const { result } = await renderLoadedProviderConfig();
    const initialCallCount = mockAuthenticatedFetch.mock.calls.length;

    await act(() => result.current.refreshProviders());

    expect(mockAuthenticatedFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
  });
});
