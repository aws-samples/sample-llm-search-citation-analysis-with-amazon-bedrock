import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { useDashboardData } from './useDashboardData';
import {
  MOCK_CITATIONS_URL,
  MOCK_KEYWORDS_URL,
  MOCK_STATS_URL,
  mockCitations,
  mockKeywords,
  mockSearches,
  mockStats,
  createMockFetch,
  renderLoadedDashboard,
} from './useDashboardData-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const citationsTimeout = {
  failingUrls: [MOCK_CITATIONS_URL],
  failStatus: 504,
};

describe('useDashboardData per-panel loading', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
  });

  it('keeps stats, searches and keywords when citations times out with 504', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);

    expect(result.current.stats).toStrictEqual(mockStats);
    expect(result.current.searches).toStrictEqual(mockSearches);
    expect(result.current.keywords).toStrictEqual(mockKeywords);
    expect(result.current.citations).toBeNull();
  });

  it('reports "Request timed out" on the citations panel only when citations answers 504', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);

    expect(result.current.panels).toStrictEqual({
      stats: {
        error: null,
        retrying: false 
      },
      citations: {
        error: 'Request timed out',
        retrying: false 
      },
      searches: {
        error: null,
        retrying: false 
      },
      keywords: {
        error: null,
        retrying: false 
      },
    });
  });

  it('leaves the app-wide error null when a panel times out', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);

    expect(result.current.error).toBeNull();
  });

  it('reports a server error on the stats panel when stats answers 500', async () => {
    const { result } = await renderLoadedDashboard({ failingUrls: [MOCK_STATS_URL] });

    expect(result.current.panels.stats.error).toBe('Server error occurred');
    expect(result.current.citations).toStrictEqual(mockCitations);
  });

  it('reports a keywords panel error and keeps the other panels when the keywords read fails', async () => {
    const { result } = await renderLoadedDashboard({ failingUrls: [MOCK_KEYWORDS_URL] });

    expect(result.current.panels.keywords.error).toBe('Server error occurred');
    expect(result.current.stats).toStrictEqual(mockStats);
  });

  it('shows stats before a slow citations request answers', async () => {
    const answered = createMockFetch();
    mockAuthenticatedFetch.mockImplementation(async (url: string) => (
      url === MOCK_CITATIONS_URL ? new Promise<Response>(vi.fn()) : answered(url)
    ));

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => {
      expect(result.current.stats).toStrictEqual(mockStats);
    });
    expect(result.current.loading).toBe(true);
  });

  it('loads the citations panel and clears its error when retryPanel succeeds', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    await act(() => result.current.retryPanel('citations'));

    expect(result.current.citations).toStrictEqual(mockCitations);
    expect(result.current.panels.citations).toStrictEqual({
      error: null,
      retrying: false 
    });
  });

  it('requests only the retried panel when retryPanel runs', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);
    mockAuthenticatedFetch.mockClear();
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    await act(() => result.current.retryPanel('citations'));

    expect(mockAuthenticatedFetch.mock.calls.map(([url]) => url)).toStrictEqual([MOCK_CITATIONS_URL]);
  });

  it('keeps the panel error when the retried request times out again', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);

    await act(() => result.current.retryPanel('citations'));

    expect(result.current.panels.citations).toStrictEqual({
      error: 'Request timed out',
      retrying: false 
    });
  });

  it('marks the panel as retrying while its retry is in flight', async () => {
    const { result } = await renderLoadedDashboard(citationsTimeout);
    mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>(vi.fn()));

    act(() => {
      void result.current.retryPanel('citations');
    });

    expect(result.current.panels.citations).toStrictEqual({
      error: 'Request timed out',
      retrying: true 
    });
  });

  it('aborts an in-flight panel retry when the owner unmounts', async () => {
    const {
      result, unmount 
    } = await renderLoadedDashboard(citationsTimeout);
    mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>(vi.fn()));
    act(() => {
      void result.current.retryPanel('citations');
    });
    const retrySignal = mockAuthenticatedFetch.mock.lastCall?.[1]?.signal;

    unmount();

    expect(retrySignal?.aborted).toBe(true);
  });

  it('loads the keywords and clears the keywords error when the keywords retry succeeds', async () => {
    const { result } = await renderLoadedDashboard({ failingUrls: [MOCK_KEYWORDS_URL] });
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    await act(() => result.current.retryPanel('keywords'));

    expect(result.current.keywords).toStrictEqual(mockKeywords);
    expect(result.current.panels.keywords.error).toBeNull();
  });

  it('clears the keywords panel error when an authoritative reconciliation succeeds', async () => {
    const { result } = await renderLoadedDashboard({ failingUrls: [MOCK_KEYWORDS_URL] });
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    await act(() => result.current.reconcileKeywords());

    expect(result.current.panels.keywords.error).toBeNull();
  });
});
