import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { useState } from 'react';
import {
  appendHistoryPage, useContentHistoryPaging, withRefreshedFirstPage
} from './useContentHistoryPaging';
import { buildContentStudioHistory } from '../components/ContentStudio/ContentStudioHistory-fixtures';
import type { ContentStudioHistory } from '../types';

const mockApi = vi.hoisted(() => ({ fetchContentHistory: vi.fn() }));

vi.mock('../api/contentStudio', () => mockApi);

const newest = buildContentStudioHistory({
  id: 'new',
  created_at: '2026-09-03T00:00:00Z' 
});
const middle = buildContentStudioHistory({
  id: 'mid',
  created_at: '2026-09-02T00:00:00Z' 
});
const oldest = buildContentStudioHistory({
  id: 'old',
  created_at: '2026-09-01T00:00:00Z' 
});

function renderPaging() {
  return renderHook(() => {
    const [history, setHistory] = useState<ContentStudioHistory[]>([]);
    return {
      history,
      ...useContentHistoryPaging(setHistory, vi.fn()),
    };
  });
}

describe('appendHistoryPage', () => {
  it('appends only items the list does not hold yet', () => {
    expect(appendHistoryPage([newest, middle], [middle, oldest]).map((item) => item.id)).toStrictEqual(['new', 'mid', 'old']);
  });
});

describe('withRefreshedFirstPage', () => {
  it('keeps loaded items older than the refreshed page below it', () => {
    expect(withRefreshedFirstPage([newest, middle, oldest], [newest, middle]).map((item) => item.id)).toStrictEqual(['new', 'mid', 'old']);
  });

  it('drops items of the refreshed window that the new page no longer holds', () => {
    expect(withRefreshedFirstPage([newest, middle, oldest], [newest, oldest]).map((item) => item.id)).toStrictEqual(['new', 'old']);
  });

  it('empties the list when the refreshed page is empty', () => {
    expect(withRefreshedFirstPage([newest], [])).toStrictEqual([]);
  });
});

describe('useContentHistoryPaging', () => {
  beforeEach(() => {
    mockApi.fetchContentHistory.mockReset();
    mockApi.fetchContentHistory.mockResolvedValue({
      history: [oldest],
      nextToken: null,
      unviewedCount: 0,
      unviewedCountCapped: false,
    });
  });

  it('requests the page after the first page token', async () => {
    const { result } = renderPaging();
    act(() => result.current.applyFirstPage({
      history: [newest],
      nextToken: 'page-2',
      unviewedCount: 0,
      unviewedCountCapped: false 
    }));

    await act(() => result.current.loadMoreHistory());

    expect(mockApi.fetchContentHistory).toHaveBeenCalledWith(20, undefined, 'page-2');
  });

  it('appends the older page and reports no further pages', async () => {
    const { result } = renderPaging();
    act(() => result.current.applyFirstPage({
      history: [newest],
      nextToken: 'page-2',
      unviewedCount: 0,
      unviewedCountCapped: false 
    }));

    await act(() => result.current.loadMoreHistory());

    expect([result.current.history.map((item) => item.id), result.current.historyHasMore]).toStrictEqual([['new', 'old'], false]);
  });

  it('keeps the older pages when the first page is refreshed after loading more', async () => {
    const { result } = renderPaging();
    const firstPage = {
      history: [newest],
      nextToken: 'page-2',
      unviewedCount: 0,
      unviewedCountCapped: false 
    };
    act(() => result.current.applyFirstPage(firstPage));
    await act(() => result.current.loadMoreHistory());

    act(() => result.current.applyFirstPage(firstPage));

    expect(result.current.history.map((item) => item.id)).toStrictEqual(['new', 'old']);
  });
});
