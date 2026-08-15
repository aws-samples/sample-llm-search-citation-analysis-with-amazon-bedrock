import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  LATE_KEYWORD_RECONCILIATION_MS, useDashboardData
} from './useDashboardData';
import {
  MOCK_AUTHORITATIVE_KEYWORDS_URL,
  MOCK_KEYWORDS_URL,
  mockStats,
  mockCitations,
  mockSearches,
  mockKeywords,
  createMockAuthoritativeKeywordsResponse,
  createMockDelayedJsonResponse,
  createMockFetch,
  createMockKeywords,
} from './useDashboardData-fixtures';

vi.mock('../infrastructure', async () => {
  const actualInfrastructure = await vi.importActual<typeof import('../infrastructure')>(
    '../infrastructure'
  );
  return {
    ...actualInfrastructure,
    API_BASE_URL: 'https://api.test.com',
    authenticatedFetch: vi.fn(),
  };
});

import { authenticatedFetch } from '../infrastructure';

const mockAuthenticatedFetch = vi.mocked(authenticatedFetch);

describe('useDashboardData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns loading true while the initial dashboard request is pending', () => {
    mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>(vi.fn()));

    const { result } = renderHook(() => useDashboardData());

    expect(result.current.loading).toBe(true);
  });

  it('returns stats and citations when the initial dashboard request succeeds', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.stats).toStrictEqual(mockStats);
    expect(result.current.citations).toStrictEqual(mockCitations);
  });

  it('returns searches and keywords from the ordinary endpoint on mount', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.searches).toStrictEqual(mockSearches);
    expect(result.current.keywords).toStrictEqual(mockKeywords);
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      MOCK_KEYWORDS_URL,
      { signal: expect.any(AbortSignal) }
    );
  });

  it('returns null error when the initial dashboard request succeeds', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
  });

  it('returns the dashboard network message when an API request fails', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Unable to load dashboard data');
    expect(result.current.stats?.total_searches).toBe(0);
  });

  it('issues four new API requests when refetch is called', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(8);
  });

  it('updates lastUpdate when the initial dashboard request succeeds', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const beforeFetch = new Date();

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.lastUpdate.getTime()).toBeGreaterThanOrEqual(beforeFetch.getTime());
  });

  it('replaces keywords when setKeywords receives a new list', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const newKeywords = createMockKeywords(1, 'new-keyword');
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setKeywords(newKeywords);
    });

    expect(result.current.keywords).toStrictEqual(newKeywords);
  });

  it('keeps the dashboard usable when API payloads have invalid shapes', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({
      stats: { invalid: 'data' },
      citations: { invalid: 'data' },
      searches: { invalid: 'data' },
      keywords: { invalid: 'data' },
    }));

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
  });

  it('aborts the active dashboard request when the owner unmounts', () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>(vi.fn()));
    const { unmount } = renderHook(() => useDashboardData());

    unmount();

    expect(abortSpy).toHaveBeenCalledWith();
    abortSpy.mockRestore();
  });

  it('returns the same reconciliation callback after rerender', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const {
      result, rerender
    } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const initialReconciliation = result.current.reconcileKeywords;

    rerender();

    expect(result.current.reconcileKeywords).toBe(initialReconciliation);
  });

  it('fetches the exact authoritative URL with an abort signal during reconciliation', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reconcileKeywords();
    });

    expect(mockAuthenticatedFetch).toHaveBeenLastCalledWith(
      MOCK_AUTHORITATIVE_KEYWORDS_URL,
      { signal: expect.any(AbortSignal) }
    );
  });

  it('replaces keywords immediately when reconciliation receives a complete response', async () => {
    const reconciledKeywords = createMockKeywords(2, 'reconciled');
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ authoritativeResponse: createMockAuthoritativeKeywordsResponse(reconciledKeywords) }));
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reconcileKeywords();
    });

    expect(result.current.keywords).toStrictEqual(reconciledKeywords);
  });

  it('starts the delayed authoritative refresh at exactly 125000 milliseconds', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();

    await act(async () => {
      await result.current.reconcileKeywords();
    });

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(5);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATE_KEYWORD_RECONCILIATION_MS - 1);
    });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(5);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(6);
  });

  it('aborts the prior authoritative refresh when reconciliation runs again', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const {
      result, unmount
    } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>(vi.fn()));

    act(() => {
      void result.current.reconcileKeywords();
    });
    const firstSignal = mockAuthenticatedFetch.mock.calls[4]?.[1]?.signal;
    act(() => {
      void result.current.reconcileKeywords();
    });
    const secondSignal = mockAuthenticatedFetch.mock.calls[5]?.[1]?.signal;

    expect(firstSignal?.aborted).toBe(true);
    expect(secondSignal?.aborted).toBe(false);
    unmount();
  });

  it('accepts a complete authoritative replacement containing 501 keywords', async () => {
    const authoritativeKeywords = createMockKeywords(501, 'authoritative');
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ authoritativeResponse: createMockAuthoritativeKeywordsResponse(authoritativeKeywords) }));
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reconcileKeywords();
    });

    expect(result.current.keywords).toStrictEqual(authoritativeKeywords);
  });

  it('preserves keywords when authoritative count differs from the array length', async () => {
    const replacementKeywords = createMockKeywords(2, 'mismatched');
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ authoritativeResponse: createMockAuthoritativeKeywordsResponse(replacementKeywords, 1) }));
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reconcileKeywords();
    });

    expect(result.current.keywords).toStrictEqual(mockKeywords);
  });

  it('preserves keywords when the authoritative response is incomplete', async () => {
    const replacementKeywords = createMockKeywords(1, 'incomplete');
    mockAuthenticatedFetch.mockImplementation(createMockFetch({
      authoritativeResponse: createMockAuthoritativeKeywordsResponse(
        replacementKeywords,
        replacementKeywords.length,
        false
      ),
    }));
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reconcileKeywords();
    });

    expect(result.current.keywords).toStrictEqual(mockKeywords);
  });

  it('preserves keywords when an authoritative keyword has an invalid status', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({
      authoritativeResponse: {
        keywords: [{
          id: 'invalid-status',
          keyword: 'invalid status',
          created_at: '2024-01-01',
          status: 'archived',
        }],
        count: 1,
        complete: true,
      },
    }));
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reconcileKeywords();
    });

    expect(result.current.keywords).toStrictEqual(mockKeywords);
  });

  it('keeps newer reconciled keywords when an older full fetch resolves last', async () => {
    vi.useFakeTimers();
    const olderKeywords = createMockKeywords(1, 'older-full');
    const reconciledKeywords = createMockKeywords(1, 'newer-reconciliation');
    const defaultFetch = createMockFetch({ authoritativeResponse: createMockAuthoritativeKeywordsResponse(reconciledKeywords) });
    mockAuthenticatedFetch.mockImplementation((url) => {
      if (url === MOCK_KEYWORDS_URL) {
        return createMockDelayedJsonResponse({ keywords: olderKeywords }, 100);
      }
      return defaultFetch(url);
    });
    const { result } = renderHook(() => useDashboardData());

    await act(async () => {
      await result.current.reconcileKeywords();
    });
    expect(result.current.keywords).toStrictEqual(reconciledKeywords);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.keywords).toStrictEqual(reconciledKeywords);
    expect(result.current.loading).toBe(false);
  });

  it('keeps newer full-fetch keywords when an aborted reconciliation resolves last', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    const staleReconciliationKeywords = createMockKeywords(1, 'stale-reconciliation');
    const newerFullFetchKeywords = createMockKeywords(1, 'newer-full');
    const defaultFetch = createMockFetch({ keywords: newerFullFetchKeywords });
    mockAuthenticatedFetch.mockImplementation((url) => {
      if (url === MOCK_AUTHORITATIVE_KEYWORDS_URL) {
        return createMockDelayedJsonResponse(
          createMockAuthoritativeKeywordsResponse(staleReconciliationKeywords),
          100
        );
      }
      return defaultFetch(url);
    });
    const reconciliationCompletion = { current: Promise.resolve() };

    act(() => {
      reconciliationCompletion.current = result.current.reconcileKeywords();
    });
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.keywords).toStrictEqual(newerFullFetchKeywords);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      await reconciliationCompletion.current;
    });

    expect(result.current.keywords).toStrictEqual(newerFullFetchKeywords);
  });

  it('keeps the newest reconciliation when abort-ignoring reads resolve out of order', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    const staleKeywords = createMockKeywords(1, 'stale');
    const newestKeywords = createMockKeywords(1, 'newest');
    const requestSequence = { value: 0 };
    mockAuthenticatedFetch.mockImplementation(() => {
      requestSequence.value += 1;
      const isFirstRequest = requestSequence.value === 1;
      const responseKeywords = isFirstRequest ? staleKeywords : newestKeywords;
      const responseDelay = isFirstRequest ? 100 : 10;
      return createMockDelayedJsonResponse(
        createMockAuthoritativeKeywordsResponse(responseKeywords),
        responseDelay
      );
    });
    const reconciliationCompletions: Promise<void>[] = [];

    act(() => {
      reconciliationCompletions.push(result.current.reconcileKeywords());
      reconciliationCompletions.push(result.current.reconcileKeywords());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.keywords).toStrictEqual(newestKeywords);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90);
      await Promise.all(reconciliationCompletions);
    });

    expect(result.current.keywords).toStrictEqual(newestKeywords);
  });

  it('does not start the delayed reconciliation after the owner unmounts', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const {
      result, unmount
    } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    await act(async () => {
      await result.current.reconcileKeywords();
    });
    const requestsBeforeUnmount = mockAuthenticatedFetch.mock.calls.length;

    unmount();
    await vi.advanceTimersByTimeAsync(LATE_KEYWORD_RECONCILIATION_MS);

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(requestsBeforeUnmount);
  });

  it('aborts the active authoritative refresh when the owner unmounts', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const {
      result, unmount
    } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>(vi.fn()));

    act(() => {
      void result.current.reconcileKeywords();
    });
    const activeSignal = mockAuthenticatedFetch.mock.calls[4]?.[1]?.signal;
    unmount();

    expect(activeSignal).toBeInstanceOf(AbortSignal);
    expect(activeSignal?.aborted).toBe(true);
  });

  it('performs no fetch when a captured reconciliation callback runs after unmount', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const {
      result, unmount
    } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const capturedReconciliation = result.current.reconcileKeywords;
    const requestsBeforeUnmount = mockAuthenticatedFetch.mock.calls.length;
    vi.useFakeTimers();
    unmount();

    await act(async () => {
      await capturedReconciliation();
      await vi.advanceTimersByTimeAsync(LATE_KEYWORD_RECONCILIATION_MS);
    });

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(requestsBeforeUnmount);
  });
});
