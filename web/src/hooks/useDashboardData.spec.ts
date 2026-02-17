import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useDashboardData } from './useDashboardData';
import {
  mockStats,
  mockCitations,
  mockSearches,
  mockKeywords,
  createMockFetch,
} from './useDashboardData-fixtures';

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

describe('useDashboardData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns loading true initially', () => {
    // Create a promise that never resolves to keep loading state
    mockAuthenticatedFetch.mockImplementation(() => new Promise(vi.fn()));
    
    const { result } = renderHook(() => useDashboardData());
    
    expect(result.current.loading).toBe(true);
  });

  it('fetches and returns stats and citations on mount', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.stats).toStrictEqual(mockStats);
    expect(result.current.citations).toStrictEqual(mockCitations);
  });

  it('fetches and returns searches and keywords on mount', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.searches).toStrictEqual(mockSearches);
    expect(result.current.keywords).toStrictEqual(mockKeywords);
  });

  it('returns null error on successful fetch', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
  });

  it('sets error message when API request fails', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.stats?.total_searches).toBe(0);
  });

  it('refetches data when refetch called', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const initialCallCount = mockAuthenticatedFetch.mock.calls.length;

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockAuthenticatedFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it('updates lastUpdate timestamp after successful fetch', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const beforeFetch = new Date();
    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.lastUpdate.getTime()).toBeGreaterThanOrEqual(beforeFetch.getTime());
  });

  it('allows updating keywords via setKeywords', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const newKeywords = [{
      id: '1',
      keyword: 'new keyword',
      created_at: '2024-02-01' 
    }];

    act(() => {
      result.current.setKeywords(newKeywords);
    });

    expect(result.current.keywords).toStrictEqual(newKeywords);
  });

  it('handles invalid response format gracefully', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({
      stats: { invalid: 'data' },
      citations: { invalid: 'data' },
      searches: { invalid: 'data' },
      keywords: { invalid: 'data' },
    }));

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Invalid responses should not crash
    expect(result.current.error).toBeNull();
  });

  it('aborts pending request on unmount', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    // Create a promise that never resolves
    mockAuthenticatedFetch.mockImplementation(() => new Promise(vi.fn()));

    const { unmount } = renderHook(() => useDashboardData());

    unmount();

    expect(abortSpy).toHaveBeenCalledWith();
    abortSpy.mockRestore();
  });
});
