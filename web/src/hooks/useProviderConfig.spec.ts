import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useProviderConfig } from './useProviderConfig';
import {
  mockProviders, renderLoadedProviderConfig 
} from './useProviderConfig-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';


function countProviderListRequests(): number {
  return mockAuthenticatedFetch.mock.calls.filter(([url]) => url.endsWith('/providers')).length;
}

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

    expect(result.current.error).toBeTruthy();
    // Default providers
    expect(result.current.providers).toHaveLength(4);
  });

  it('returns true when updateProvider succeeds', async () => {
    const { result } = await renderLoadedProviderConfig();

    const updated = await act(() => result.current.updateProvider('openai', { enabled: false }));

    expect(updated).toBe(true);
  });

  it('returns false when updateProvider fails', async () => {
    const { result } = await renderLoadedProviderConfig({ updateSuccess: false });

    const updated = await act(() => result.current.updateProvider('openai', { enabled: false }));

    expect(updated).toBe(false);
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

  it('returns valid true when validateKey succeeds', async () => {
    const { result } = await renderLoadedProviderConfig({ validationResult: { valid: true } });

    const validation = await act(() => result.current.validateKey('openai', 'test-key'));

    expect(validation).toStrictEqual({ valid: true });
  });

  it('returns valid false with error when validateKey fails', async () => {
    const { result } = await renderLoadedProviderConfig({
      validationResult: {
        valid: false,
        error: 'Invalid API key' 
      },
    });

    const validation = await act(() => result.current.validateKey('openai', 'bad-key'));

    expect(validation).toStrictEqual({
      valid: false,
      error: 'Invalid API key' 
    });
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
