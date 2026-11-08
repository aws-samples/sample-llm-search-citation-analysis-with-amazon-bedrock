import {
  useMemo, useState
} from 'react';
import type {
  Keyword, ResearchKeyword
} from '../types';
import type { KeywordRow } from '../types/api/seo';
import { useKeywordGroups } from './useKeywordGroups';
import {
  usePromoteKeywords, type UsePromoteKeywords
} from './usePromoteKeywords';

export interface KeywordExplorerTracking {
  /** Selection, market (follows the header) and the "Track keywords" request (`POST /keywords/promote`). */
  readonly promotion: UsePromoteKeywords;
  readonly groups: ReturnType<typeof useKeywordGroups>['groups'];
  readonly groupsLoading: boolean;
  /** The group tracked keywords join; `''` = no group. */
  readonly groupId: string;
  readonly chooseGroup: (groupId: string) => void;
}

const NO_GROUP: string[] = [];

/** A research row in the shape the promote API takes; intent lands in the keyword's notes. */
export function explorerResearchKeyword(row: KeywordRow): ResearchKeyword {
  return {
    keyword: row.keyword,
    intent: row.intent,
    competition: '',
    relevance: 0,
    source: 'keyword explorer',
  };
}

/**
 * Tracking selected Keyword Explorer rows: they are created (or, when they
 * already exist, grouped) through the existing promote API with the header
 * market and the chosen group, so a tracked keyword is an ordinary keyword. Tracking makes no DataForSEO
 * call: the research route already stored the metrics of every row it
 * returned for a national market, so fetching them again would pay twice.
 */
export function useKeywordExplorerTracking(
  rows: readonly KeywordRow[],
  onKeywordsAdded?: (created: Keyword[]) => void,
): KeywordExplorerTracking {
  const {
    groups, loading: groupsLoading
  } = useKeywordGroups();
  const [groupId, chooseGroup] = useState('');
  const groupIds = useMemo(() => (groupId === '' ? NO_GROUP : [groupId]), [groupId]);
  const available = useMemo(() => rows.map(explorerResearchKeyword), [rows]);
  const promotion = usePromoteKeywords(available, onKeywordsAdded, { groupIds });

  return {
    promotion,
    groups,
    groupsLoading,
    groupId,
    chooseGroup,
  };
}
