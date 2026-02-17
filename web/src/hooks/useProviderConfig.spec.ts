import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useProviderConfig } from './useProviderConfig';
import {
  mockProviders, createMockFetch 
} from './useProviderConfig-fixtures';

vi.mock('../infrastructure', async () => {
  const actual = await vi.importActual('../infrastructure');
  return {
    ...actual,
    API_BASE_URL: 'https://api.test.com',
    authenticatedFetch: vi.fn(),
  };
});

import { authenticatedFetch } from '../infrastructure';

const mockAuthenticatedFetch = authenticatedFetch as ReturnType<typeof vi.fn>;

describe('useProviderConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns loading true initially', () => {
    // Create a promise that never resolves
    mockAuthenticatedFetch.mockImplementation(() => new Promise(vi.fn()));

    const { result } = renderHook(() => useProviderConfig());

    expect(result.current.loading).toBe(true);
  });

  it('fetches and returns providers on mount', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useProviderConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.providers).toStrictEqual(mockProviders);
    expect(result.current.error).toBeNull();
  });

  it('sets error and returns default providers when fetch fails', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

    const { result } = renderHook(() => useProviderConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    // Default providers
    expect(result.current.providers).toHaveLength(4);
  });

  it('returns true when updateProvider succeeds', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useProviderConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const updateResult = { value: false };
    await act(async () => {
      updateResult.value = await result.current.updateProvider('openai', { enabled: false });
    });

    expect(updateResult.value).toBe(true);
  });

  it('returns false when updateProvider fails', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ updateSuccess: false }));

    const { result } = renderHook(() => useProviderConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const updateResult = { value: true };
    await act(async () => {
      updateResult.value = await result.current.updateProvider('openai', { enabled: false });
    });

    expect(updateResult.value).toBe(false);
  });

  it('sends correct payload when updating provider with api_key', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useProviderConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateProvider('openai', { api_key: 'new-key-123' });
    });

    const updateCall = mockAuthenticatedFetch.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes('/providers/openai') && (call[1] as RequestInit)?.method === 'PUT'
    );
    expect(updateCall).toBeDefined();
    const body = JSON.parse((updateCall as [string, { body: string }])[1].body) as { api_key: string };
    expect(body.api_key).toBe('new-key-123');
  });

  it('returns valid true when validateKey succeeds', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ validationResult: { valid: true } }));

    const { result } = renderHook(() => useProviderConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const validationResult: {
      valid: boolean;
      error?: string 
    } = { valid: false };
    await act(async () => {
      const res = await result.current.validateKey('openai', 'test-key');
      validationResult.valid = res.valid;
      validationResult.error = res.error;
    });

    expect(validationResult.valid).toBe(true);
  });

  it('returns valid false with error when validateKey fails', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({
      validationResult: {
        valid: false,
        error: 'Invalid API key' 
      },
    }));

    const { result } = renderHook(() => useProviderConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const validationResult: {
      valid: boolean;
      error?: string 
    } = { valid: true };
    await act(async () => {
      const res = await result.current.validateKey('openai', 'bad-key');
      validationResult.valid = res.valid;
      validationResult.error = res.error;
    });

    expect(validationResult.valid).toBe(false);
    expect(validationResult.error).toBe('Invalid API key');
  });

  it('refreshes providers after successful update', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useProviderConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const initialCallCount = mockAuthenticatedFetch.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).endsWith('/providers')
    ).length;

    await act(async () => {
      await result.current.updateProvider('openai', { enabled: false });
    });

    const finalCallCount = mockAuthenticatedFetch.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).endsWith('/providers')
    ).length;

    expect(finalCallCount).toBeGreaterThan(initialCallCount);
  });

  it('refetches providers when refreshProviders called', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useProviderConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const initialCallCount = mockAuthenticatedFetch.mock.calls.length;

    await act(async () => {
      await result.current.refreshProviders();
    });

    expect(mockAuthenticatedFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
  });
});
