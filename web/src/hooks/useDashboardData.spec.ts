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
  IDLE_PANEL, IDLE_PANEL_STATES
} from './dashboardPanels';
import {
  MOCK_AUTHORITATIVE_KEYWORDS_URL,
  MOCK_CITATIONS_URL,
  MOCK_KEYWORDS_URL,
  MOCK_SEARCHES_URL,
  MOCK_STATS_URL,
  mockStats,
  mockCitations,
  mockSearches,
  mockKeywords,
  createMockDelayedJsonResponse,
  createMockFetch,
  createMockKeywords,
  renderLoadedDashboard,
  renderReconciledDashboard,
  renderRetriedDashboard,
  startPendingKeywordReconciliation,
  startPendingPanelRetry,
} from './useDashboardData-fixtures';
import { buildKeywordsPage } from '../api/keywordPages-fixtures';

import { advanceFakeTime } from '../test/fakeTime';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { spyOnAbortAfterPendingUnmount } from '../test/abortOnUnmount';

/** `/citations` answering API Gateway's 504 while the other reads succeed. */
const citationsTimeout = {
  failingUrls: [MOCK_CITATIONS_URL],
  failStatus: 504,
};


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

  it('returns the token of the next searches page from the first page', async () => {
    const { result } = await renderLoadedDashboard({ searchesNextToken: 'older-searches' });

    expect(result.current.searchesNextToken).toBe('older-searches');
  });

  it('returns a null searches token when the first page is the last one', async () => {
    const { result } = await renderLoadedDashboard();

    expect(result.current.searchesNextToken).toBeNull();
  });

  it('reports a server error on every panel without blanking the dashboard when every request fails', async () => {
    const { result } = await renderLoadedDashboard({ shouldFail: true });

    expect(result.current.error).toBeNull();
    expect(Object.values(result.current.panels).map((panel) => panel.error)).toStrictEqual([
      'Server error occurred', 'Server error occurred', 'Server error occurred', 'Server error occurred',
    ]);
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

  it('keeps the dashboard usable when panel payloads have invalid shapes', async () => {
    const { result } = await renderLoadedDashboard({
      stats: { invalid: 'data' },
      citations: { invalid: 'data' },
      searches: { invalid: 'data' },
    });

    expect(result.current.error).toBeNull();
  });

  it('reports an invalid-request error on the keywords panel when a keyword page has an invalid shape', async () => {
    const { result } = await renderLoadedDashboard({ keywordsPage: { invalid: 'data' } });

    expect(result.current.panels.keywords.error).toBe('Invalid request');
  });

  it('aborts the active dashboard request when the owner unmounts', () => {
    const abortSpy = spyOnAbortAfterPendingUnmount(() => renderHook(() => useDashboardData()));

    expect(abortSpy).toHaveBeenCalledWith();
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
    await renderReconciledDashboard();

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
        authoritativeResponse: buildKeywordsPage(reconciledKeywords),
        expectedKeywords: reconciledKeywords,
      },
      {
        outcome: 'accepts the complete replacement',
        condition: 'the authoritative response contains 501 keywords',
        authoritativeResponse: buildKeywordsPage(largeReplacement),
        expectedKeywords: largeReplacement,
      },
      {
        outcome: 'preserves keywords',
        condition: 'the authoritative count differs from the array length',
        authoritativeResponse: buildKeywordsPage(mismatchedKeywords, null, 1),
        expectedKeywords: mockKeywords,
      },
      {
        outcome: 'preserves keywords',
        condition: 'the authoritative page has no continuation token field',
        authoritativeResponse: {
          keywords: incompleteKeywords,
          count: incompleteKeywords.length,
        },
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
          next_token: null,
        },
        expectedKeywords: mockKeywords,
      },
    ];

    it.each(replacementCases)('$outcome when $condition', async ({
      authoritativeResponse, expectedKeywords
    }) => {
      const { result } = await renderReconciledDashboard({ authoritativeResponse });

      expect(result.current.keywords).toStrictEqual(expectedKeywords);
    });
  });

  it('starts the delayed authoritative refresh at exactly 35000 milliseconds', async () => {
    const { result } = await renderLoadedDashboard();
    vi.useFakeTimers();

    await act(() => result.current.reconcileKeywords());

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(5);
    await advanceFakeTime(LATE_KEYWORD_RECONCILIATION_MS - 1);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(5);
    await advanceFakeTime(1);
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
    const defaultFetch = createMockFetch({ authoritativeResponse: buildKeywordsPage(reconciledKeywords) });
    mockAuthenticatedFetch.mockImplementation((url) => {
      if (url === MOCK_KEYWORDS_URL) {
        return createMockDelayedJsonResponse(buildKeywordsPage(olderKeywords), 100);
      }
      return defaultFetch(url);
    });
    const { result } = renderHook(() => useDashboardData());

    await act(() => result.current.reconcileKeywords());
    expect(result.current.keywords).toStrictEqual(reconciledKeywords);

    await advanceFakeTime(100);

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
          buildKeywordsPage(staleReconciliationKeywords),
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
        buildKeywordsPage(responseKeywords),
        responseDelay
      );
    });
    const reconciliationCompletions: Promise<void>[] = [];

    act(() => {
      reconciliationCompletions.push(result.current.reconcileKeywords());
      reconciliationCompletions.push(result.current.reconcileKeywords());
    });
    await advanceFakeTime(10);
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

  it('keeps stats, searches and keywords when citations times out with 504', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);
    const {
      stats, citations, searches, keywords
    } = result.current;

    expect({
      stats,
      citations,
      searches,
      keywords,
    }).toStrictEqual({
      stats: mockStats,
      citations: null,
      searches: mockSearches,
      keywords: mockKeywords,
    });
  });

  it('reports "Request timed out" on the citations panel only when citations answers 504', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);

    expect(result.current.panels).toStrictEqual({
      ...IDLE_PANEL_STATES,
      citations: {
        error: 'Request timed out',
        retrying: false,
      },
    });
  });

  it('leaves the app-wide error null when a panel times out', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);

    expect(result.current.error).toBeNull();
  });

  it.each([
    {
      panel: 'stats',
      url: MOCK_STATS_URL,
    },
    {
      panel: 'searches',
      url: MOCK_SEARCHES_URL,
    },
    {
      panel: 'keywords',
      url: MOCK_KEYWORDS_URL,
    },
  ] as const)('reports a server error on the $panel panel and still loads the citations when $panel answers 500', async ({
    panel, url
  }) => {
    const { result } = await renderLoadedDashboard({ failingUrls: [url] });

    expect([result.current.panels[panel].error, result.current.citations]).toStrictEqual(['Server error occurred', mockCitations]);
  });

  it('shows stats before a slow citations request answers', async () => {
    const answered = createMockFetch();
    mockAuthenticatedFetch.mockImplementation(async (url: string) => (
      url === MOCK_CITATIONS_URL ? new Promise<Response>(vi.fn()) : answered(url)
    ));

    const { result } = renderHook(() => useDashboardData());

    await vi.waitFor(() => {
      expect(result.current.stats).toStrictEqual(mockStats);
    });
    expect(result.current.loading).toBe(true);
  });

  it('loads the citations panel and clears its error when retryPanel succeeds', async () => {
    const { result } = await renderRetriedDashboard(citationsTimeout, 'citations');

    expect([result.current.citations, result.current.panels.citations]).toStrictEqual([mockCitations, IDLE_PANEL]);
  });

  it('requests only the retried panel when retryPanel runs', async () => {
    await renderRetriedDashboard(citationsTimeout, 'citations');

    expect(mockAuthenticatedFetch.mock.calls.map(([url]) => url)).toStrictEqual([MOCK_CITATIONS_URL]);
  });

  it('keeps the panel error when the retried request times out again', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);

    await act(() => result.current.retryPanel('citations'));

    expect(result.current.panels.citations.error).toBe('Request timed out');
  });

  it('marks the panel as retrying while its retry is in flight', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);

    startPendingPanelRetry(result, 'citations');

    expect(result.current.panels.citations.retrying).toBe(true);
  });

  it('aborts an in-flight panel retry when the owner unmounts', async () => {
    const {
      result, unmount
    } = await renderLoadedDashboard(citationsTimeout);
    const retrySignal = startPendingPanelRetry(result, 'citations');

    unmount();

    expect(retrySignal?.aborted).toBe(true);
  });

  it('loads the keywords and clears the keywords error when the keywords retry succeeds', async () => {
    const { result } = await renderRetriedDashboard({ failingUrls: [MOCK_KEYWORDS_URL] }, 'keywords');

    expect([result.current.keywords, result.current.panels.keywords]).toStrictEqual([mockKeywords, IDLE_PANEL]);
  });

  it('clears the keywords panel error when an authoritative reconciliation succeeds', async () => {
    const { result } = await renderReconciledDashboard({ failingUrls: [MOCK_KEYWORDS_URL] });

    expect(result.current.panels.keywords.error).toBeNull();
  });
});
