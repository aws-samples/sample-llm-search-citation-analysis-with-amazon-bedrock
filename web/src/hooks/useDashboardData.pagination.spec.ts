import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { useDashboardData } from './useDashboardData';
import {
  MOCK_API_BASE_URL,
  MOCK_AUTHORITATIVE_SECOND_PAGE_URL,
  MOCK_KEYWORDS_URL,
  MOCK_KEYWORDS_SECOND_PAGE_URL,
  mockKeywords,
  createMockFetch,
  createMockKeywords,
  renderLoadedDashboard,
} from './useDashboardData-fixtures';
import {
  buildKeyword, buildKeywordsPage
} from '../api/keywordPages-fixtures';
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const olderKeyword = buildKeyword('older', '2026-01-01T00:00:00Z');
const newerKeyword = buildKeyword('newer', '2026-02-01T00:00:00Z');
const reconciledPage = buildKeywordsPage(createMockKeywords(1, 'reconciled'), 'page-2');

describe('useDashboardData keyword pagination', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
  });

  it('assembles every ordinary keyword page newest first on mount', async () => {
    const { result } = await renderLoadedDashboard({
      keywordsPage: buildKeywordsPage([olderKeyword], 'page-2'),
      extraPayloads: { [MOCK_KEYWORDS_SECOND_PAGE_URL]: buildKeywordsPage([newerKeyword]) },
    });

    expect(result.current.keywords).toStrictEqual([newerKeyword, olderKeyword]);
  });

  it('reports the dashboard error without a partial keyword list when a later page fails', async () => {
    const { result } = await renderLoadedDashboard({
      keywordsPage: buildKeywordsPage([olderKeyword], 'page-2'),
      failingUrls: [MOCK_KEYWORDS_SECOND_PAGE_URL],
    });

    expect(result.current.error).toBe('Failed to load dashboard');
    expect(result.current.keywords).toStrictEqual([]);
  });

  it('replaces keywords with every authoritative page when reconciliation crosses pages', async () => {
    const { result } = await renderLoadedDashboard({
      authoritativeResponse: buildKeywordsPage([olderKeyword], 'page-2'),
      extraPayloads: { [MOCK_AUTHORITATIVE_SECOND_PAGE_URL]: buildKeywordsPage([newerKeyword]) },
    });

    await act(() => result.current.reconcileKeywords());

    expect(result.current.keywords).toStrictEqual([newerKeyword, olderKeyword]);
  });

  it('preserves keywords when a later authoritative page fails', async () => {
    const { result } = await renderLoadedDashboard({
      authoritativeResponse: reconciledPage,
      failingUrls: [MOCK_AUTHORITATIVE_SECOND_PAGE_URL],
    });

    await act(() => result.current.reconcileKeywords());

    expect(result.current.keywords).toStrictEqual(mockKeywords);
  });

  it('preserves keywords when the authoritative pages repeat a continuation token', async () => {
    const { result } = await renderLoadedDashboard({
      authoritativeResponse: reconciledPage,
      extraPayloads: { [MOCK_AUTHORITATIVE_SECOND_PAGE_URL]: reconciledPage },
    });

    await act(() => result.current.reconcileKeywords());

    expect(result.current.keywords).toStrictEqual(mockKeywords);
  });

  it('applies no reconciled keywords when a refetch supersedes reconciliation between pages', async () => {
    const newerFullFetchKeywords = createMockKeywords(1, 'newer-full');
    const { result } = await renderLoadedDashboard();
    const secondPage = createDeferredResponse();
    const defaultFetch = createMockFetch({
      keywords: newerFullFetchKeywords,
      authoritativeResponse: reconciledPage,
    });
    mockAuthenticatedFetch.mockImplementation((url) => (
      url === MOCK_AUTHORITATIVE_SECOND_PAGE_URL ? secondPage.promise : defaultFetch(url)
    ));
    const reconciliation = { completion: Promise.resolve() };

    act(() => {
      reconciliation.completion = result.current.reconcileKeywords();
    });
    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      MOCK_AUTHORITATIVE_SECOND_PAGE_URL,
      { signal: expect.any(AbortSignal) }
    ));
    await act(() => result.current.refetch());
    await act(async () => {
      secondPage.resolve(createMockJsonResponse(buildKeywordsPage(createMockKeywords(1, 'stale'))));
      await reconciliation.completion;
    });

    expect(result.current.keywords).toStrictEqual(newerFullFetchKeywords);
  });

  it('aborts the in-flight authoritative page when a refetch supersedes reconciliation', async () => {
    const { result } = await renderLoadedDashboard({ authoritativeResponse: reconciledPage });
    const defaultFetch = createMockFetch({ authoritativeResponse: reconciledPage });
    mockAuthenticatedFetch.mockImplementation((url) => (
      url === MOCK_AUTHORITATIVE_SECOND_PAGE_URL ? new Promise<Response>(vi.fn()) : defaultFetch(url)
    ));

    act(() => {
      void result.current.reconcileKeywords();
    });
    await waitFor(() => expect(mockAuthenticatedFetch.mock.lastCall?.[0]).toBe(MOCK_AUTHORITATIVE_SECOND_PAGE_URL));
    const pageSignal = mockAuthenticatedFetch.mock.lastCall?.[1]?.signal;
    await act(() => result.current.refetch());

    expect(pageSignal?.aborted).toBe(true);
  });

  it('requests the first keyword page alongside the panels before any response arrives', () => {
    mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>(vi.fn()));

    renderHook(() => useDashboardData());

    expect(mockAuthenticatedFetch.mock.calls.map(([url]) => url)).toStrictEqual([
      `${MOCK_API_BASE_URL}/stats`,
      `${MOCK_API_BASE_URL}/citations`,
      `${MOCK_API_BASE_URL}/searches`,
      MOCK_KEYWORDS_URL,
    ]);
  });
});
