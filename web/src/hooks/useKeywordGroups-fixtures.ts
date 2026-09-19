import {
  expect, vi 
} from 'vitest';
import {
  renderHook, waitFor 
} from '@testing-library/react';
import type { KeywordGroup } from '../types';
import { useKeywordGroups } from './useKeywordGroups';

/** Renders the hook and waits for the initial group load to settle. */
export async function renderLoadedKeywordGroups(options?: Parameters<typeof useKeywordGroups>[0]) {
  const rendered = renderHook(() => useKeywordGroups(options));
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

/** A keyword group as the API returns it; every field can be overridden. */
export function buildKeywordGroup(overrides: Partial<KeywordGroup> = {}): KeywordGroup {
  return {
    id: 'group-coruna',
    name: 'Hotel Coruña',
    description: '',
    keyword_count: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
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
