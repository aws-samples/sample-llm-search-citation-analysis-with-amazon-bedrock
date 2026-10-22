import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { useResearchHistoryPages } from './useResearchHistoryPages';
import { buildHistoryPage } from './useResearchHistoryPages-fixtures';

const mockApi = vi.hoisted(() => ({
  fetchKeywordResearchHistoryPage: vi.fn(),
  deleteKeywordResearch: vi.fn(),
}));

vi.mock('../api/keywordResearch', () => mockApi);

async function renderLoaded() {
  const rendered = renderHook(() => useResearchHistoryPages());
  await act(() => rendered.result.current.fetchHistory('expansion'));
  return rendered.result;
}

/** The hook after the first page and then the next one are loaded. */
async function renderSecondPageLoaded() {
  const result = await renderLoaded();
  await act(() => result.current.loadMoreHistory());
  return result;
}

describe('useResearchHistoryPages', () => {
  beforeEach(() => {
    mockApi.fetchKeywordResearchHistoryPage.mockReset();
    mockApi.fetchKeywordResearchHistoryPage
      .mockResolvedValueOnce(buildHistoryPage(['job-3', 'job-2'], 'page-2'))
      .mockResolvedValueOnce(buildHistoryPage(['job-2', 'job-1'], null));
  });

  it('reports older jobs when the first page carries a next_token', async () => {
    const result = await renderLoaded();

    expect(result.current.historyHasMore).toBe(true);
  });

  it('requests the next page of the same type filter with the token', async () => {
    await renderSecondPageLoaded();

    expect(mockApi.fetchKeywordResearchHistoryPage).toHaveBeenLastCalledWith('expansion', 'page-2');
  });

  it('appends the next page without repeating jobs already listed', async () => {
    const result = await renderSecondPageLoaded();

    expect(result.current.history.map((job) => job.id)).toStrictEqual(['job-3', 'job-2', 'job-1']);
  });

  it('reports no older jobs after the last page is loaded', async () => {
    const result = await renderSecondPageLoaded();

    expect(result.current.historyHasMore).toBe(false);
  });
});
