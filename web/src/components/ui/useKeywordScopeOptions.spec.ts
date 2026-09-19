import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Keyword } from '../../types';
import { useKeywordScopeOptions } from './useKeywordScopeOptions';
import { SCOPE_KEYWORDS } from './useKeywordScopeOptions-fixtures';

vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));

import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import {
  buildKeywordGroup, buildKeywordGroupsHookResult 
} from '../../hooks/useKeywordGroups-fixtures';

const mockUseKeywordGroups = vi.mocked(useKeywordGroups);

const pausedKeyword: Keyword = {
  id: 'kw-3',
  keyword: 'hostels',
  created_at: '2026-01-03T00:00:00Z',
  status: 'paused',
};

const inactiveKeyword: Keyword = {
  id: 'kw-4',
  keyword: 'motels',
  created_at: '2026-01-04T00:00:00Z',
  status: 'inactive',
};

describe('useKeywordScopeOptions', () => {
  beforeEach(() => {
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupsHookResult([buildKeywordGroup()]));
  });

  it('keeps keywords without a status and keywords marked active', () => {
    const { result } = renderHook(() => useKeywordScopeOptions([
      ...SCOPE_KEYWORDS,
      {
        ...pausedKeyword,
        status: 'active' 
      },
    ]));

    expect(result.current.activeKeywords.map((keyword) => keyword.keyword)).toStrictEqual(['hotels', 'resorts', 'hostels']);
  });

  it('drops paused and inactive keywords', () => {
    const { result } = renderHook(() => useKeywordScopeOptions([...SCOPE_KEYWORDS, pausedKeyword, inactiveKeyword]));

    expect(result.current.activeKeywords).toStrictEqual(SCOPE_KEYWORDS);
  });

  it('exposes the loaded keyword groups', () => {
    const { result } = renderHook(() => useKeywordScopeOptions(SCOPE_KEYWORDS));

    expect(result.current.groups).toStrictEqual([buildKeywordGroup()]);
  });

  it('returns the same active list while the keywords are unchanged', () => {
    const {
      result, rerender 
    } = renderHook(() => useKeywordScopeOptions(SCOPE_KEYWORDS));
    const firstRender = result.current.activeKeywords;

    rerender();

    expect(result.current.activeKeywords).toBe(firstRender);
  });
});
