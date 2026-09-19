import { useMemo } from 'react';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import type {
  Keyword, KeywordGroup 
} from '../../types';

/** Keywords that still run; a keyword with no status is treated as active. */
function isActiveKeyword(keyword: Keyword): boolean {
  return !keyword.status || keyword.status === 'active';
}

interface KeywordScopeOptions {
  readonly activeKeywords: Keyword[];
  readonly groups: KeywordGroup[];
}

/**
 * What a scope picker (`KeywordScopeSelector`, `KeywordScopePicker`) needs to
 * offer: the active keywords and every keyword group. Shared by the views that
 * let the user narrow a report or a run to a keyword, a group or everything.
 */
export function useKeywordScopeOptions(keywords: Keyword[]): KeywordScopeOptions {
  const { groups } = useKeywordGroups();
  const activeKeywords = useMemo(() => keywords.filter(isActiveKeyword), [keywords]);
  return {
    activeKeywords,
    groups,
  };
}
