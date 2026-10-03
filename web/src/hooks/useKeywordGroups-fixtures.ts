import { vi } from 'vitest';
import { buildGroup } from '../api/keywordGroups-fixtures';
import { renderLoadedHook } from '../test/loadedHook';
import type { KeywordGroup } from '../types';
import { useKeywordGroups } from './useKeywordGroups';

/** Renders the hook and waits for the initial group load to settle. */
export function renderLoadedKeywordGroups(options?: Parameters<typeof useKeywordGroups>[0]) {
  return renderLoadedHook(() => useKeywordGroups(options));
}

/** A keyword group as the API returns it; every field can be overridden. */
export function buildKeywordGroup(overrides: Partial<KeywordGroup> = {}): KeywordGroup {
  return buildGroup({
    description: '',
    keyword_count: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  });
}

/**
 * What a component sees from `useKeywordGroups()` once the groups have
 * loaded: the given groups, no error, and inert mutation callbacks.
 */
export function buildKeywordGroupsHookResult(
  groups: KeywordGroup[] = [buildKeywordGroup()]
): ReturnType<typeof useKeywordGroups> {
  return {
    groups,
    loading: false,
    error: null,
    refresh: vi.fn(),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    removeGroup: vi.fn(),
    changeMemberships: vi.fn(),
  };
}
