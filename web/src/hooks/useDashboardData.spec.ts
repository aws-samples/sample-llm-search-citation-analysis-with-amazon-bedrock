import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook
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
  renderLoadedDashboard,
  startPendingKeywordReconciliation,
} from './useDashboardData-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';


describe('useDashboardData', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns loading true while the initial dashboard request is pending', () => {
    mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>(vi.fn()));

    const { result } = renderHook(() => useDashboardData());

    expect(result.current.loading).toBe(true);
  });

  it('returns stats and citations when the initial dashboard request succeeds', async () => {
    const { result } = await renderLoadedDashboard();

    expect(result.current.stats).toStrictEqual(mockStats);
    expect(result.current.citations).toStrictEqual(mockCitations);
  });

  it('returns searches and keywords from the ordinary endpoint on mount', async () => {
    const { result } = await renderLoadedDashboard();

    expect(result.current.searches).toStrictEqual(mockSearches);
    expect(result.current.keywords).toStrictEqual(mockKeywords);
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      MOCK_KEYWORDS_URL,
      { signal: expect.any(AbortSignal) }
    );
  });

  it('returns null error when the initial dashboard request succeeds', async () => {
    const { result } = await renderLoadedDashboard();

    expect(result.current.error).toBeNull();
  });

  it('returns the dashboard network message when an API request fails', async () => {
    const { result } = await renderLoadedDashboard({ shouldFail: true });

    expect(result.current.error).toBe('Unable to load dashboard data');
    expect(result.current.stats?.total_searches).toBe(0);
  });

  it('issues four new API requests when refetch is called', async () => {
    const { result } = await renderLoadedDashboard();

    await act(() => result.current.refetch());

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(8);
  });

  it('updates lastUpdate when the initial dashboard request succeeds', async () => {
    const beforeFetch = new Date();

    const { result } = await renderLoadedDashboard();

    expect(result.current.lastUpdate.getTime()).toBeGreaterThanOrEqual(beforeFetch.getTime());
  });

  it('replaces keywords when setKeywords receives a new list', async () => {
    const newKeywords = createMockKeywords(1, 'new-keyword');
    const { result } = await renderLoadedDashboard();

    act(() => {
      result.current.setKeywords(newKeywords);
    });

    expect(result.current.keywords).toStrictEqual(newKeywords);
  });

  it('keeps the dashboard usable when API payloads have invalid shapes', async () => {
    const { result } = await renderLoadedDashboard({
      stats: { invalid: 'data' },
      citations: { invalid: 'data' },
      searches: { invalid: 'data' },
      keywords: { invalid: 'data' },
    });

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
    const {
      result, rerender
    } = await renderLoadedDashboard();
    const initialReconciliation = result.current.reconcileKeywords;

    rerender();

    expect(result.current.reconcileKeywords).toBe(initialReconciliation);
  });

  it('fetches the exact authoritative URL with an abort signal during reconciliation', async () => {
    const { result } = await renderLoadedDashboard();

    await act(() => result.current.reconcileKeywords());

    expect(mockAuthenticatedFetch).toHaveBeenLastCalledWith(
      MOCK_AUTHORITATIVE_KEYWORDS_URL,
      { signal: expect.any(AbortSignal) }
    );
  });

  describe('authoritative keyword replacement', () => {
    const reconciledKeywords = createMockKeywords(2, 'reconciled');
    const largeReplacement = createMockKeywords(501, 'authoritative');
    const mismatchedKeywords = createMockKeywords(2, 'mismatched');
    const incompleteKeywords = createMockKeywords(1, 'incomplete');
    const replacementCases = [
      {
        outcome: 'replaces keywords immediately',
        condition: 'reconciliation receives a complete response',
        authoritativeResponse: createMockAuthoritativeKeywordsResponse(reconciledKeywords),
        expectedKeywords: reconciledKeywords,
      },
      {
        outcome: 'accepts the complete replacement',
        condition: 'the authoritative response contains 501 keywords',
        authoritativeResponse: createMockAuthoritativeKeywordsResponse(largeReplacement),
        expectedKeywords: largeReplacement,
      },
      {
        outcome: 'preserves keywords',
        condition: 'the authoritative count differs from the array length',
        authoritativeResponse: createMockAuthoritativeKeywordsResponse(mismatchedKeywords, 1),
        expectedKeywords: mockKeywords,
      },
      {
        outcome: 'preserves keywords',
        condition: 'the authoritative response is incomplete',
        authoritativeResponse: createMockAuthoritativeKeywordsResponse(
          incompleteKeywords,
          incompleteKeywords.length,
          false
        ),
        expectedKeywords: mockKeywords,
      },
      {
        outcome: 'preserves keywords',
        condition: 'an authoritative keyword has an invalid status',
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
        expectedKeywords: mockKeywords,
      },
    ];

    it.each(replacementCases)('$outcome when $condition', async ({
      authoritativeResponse, expectedKeywords
    }) => {
      const { result } = await renderLoadedDashboard({ authoritativeResponse });

      await act(() => result.current.reconcileKeywords());

      expect(result.current.keywords).toStrictEqual(expectedKeywords);
    });
  });

  it('starts the delayed authoritative refresh at exactly 125000 milliseconds', async () => {
    const { result } = await renderLoadedDashboard();
    vi.useFakeTimers();

    await act(() => result.current.reconcileKeywords());

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
    const {
      result, unmount
    } = await renderLoadedDashboard();

    const firstSignal = startPendingKeywordReconciliation(result);
    const secondSignal = startPendingKeywordReconciliation(result);

    expect(firstSignal?.aborted).toBe(true);
    expect(secondSignal?.aborted).toBe(false);
    unmount();
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

    await act(() => result.current.reconcileKeywords());
    expect(result.current.keywords).toStrictEqual(reconciledKeywords);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.keywords).toStrictEqual(reconciledKeywords);
    expect(result.current.loading).toBe(false);
  });

  it('keeps newer full-fetch keywords when an aborted reconciliation resolves last', async () => {
    const { result } = await renderLoadedDashboard();
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
    await act(() => result.current.refetch());
    expect(result.current.keywords).toStrictEqual(newerFullFetchKeywords);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      await reconciliationCompletion.current;
    });

    expect(result.current.keywords).toStrictEqual(newerFullFetchKeywords);
  });

  it('keeps the newest reconciliation when abort-ignoring reads resolve out of order', async () => {
    const { result } = await renderLoadedDashboard();
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
    const {
      result, unmount
    } = await renderLoadedDashboard();
    vi.useFakeTimers();
    await act(() => result.current.reconcileKeywords());
    const requestsBeforeUnmount = mockAuthenticatedFetch.mock.calls.length;

    unmount();
    await vi.advanceTimersByTimeAsync(LATE_KEYWORD_RECONCILIATION_MS);

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(requestsBeforeUnmount);
  });

  it('aborts the active authoritative refresh when the owner unmounts', async () => {
    const {
      result, unmount
    } = await renderLoadedDashboard();

    const activeSignal = startPendingKeywordReconciliation(result);
    unmount();

    expect(activeSignal).toBeInstanceOf(AbortSignal);
    expect(activeSignal?.aborted).toBe(true);
  });

  it('performs no fetch when a captured reconciliation callback runs after unmount', async () => {
    const {
      result, unmount
    } = await renderLoadedDashboard();
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
