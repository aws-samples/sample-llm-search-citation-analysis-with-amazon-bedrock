import type {
  AnalysisScope, ContentBriefScope, KeywordGroup
} from '../../types';
import { withMarketIds } from '../Markets/marketScope';

/** An empty brief scope of `mode` that keeps the market filter (anything but groups is a keyword pick). */
export function emptyBriefScope(mode: AnalysisScope['mode'], marketIds: readonly string[] = []): ContentBriefScope {
  if (mode === 'groups') return withMarketIds({
    mode: 'groups',
    group_ids: [],
  }, marketIds);
  return withMarketIds({
    mode: 'keywords',
    keyword_ids: [],
  }, marketIds);
}

function keywordCount(count: number, active: boolean): string {
  const noun = count === 1 ? 'keyword' : 'keywords';
  return active ? `${count} active ${noun}` : `${count} ${noun}`;
}

/**
 * The one-line answer to "which keywords?": "5 active keywords in Eurostars
 * Madrid", "3 keywords selected", or what is still missing.
 */
export function describeBriefScope(
  scope: ContentBriefScope, groups: readonly KeywordGroup[], selectedCount: number
): string {
  if (scope.mode === 'keywords') {
    return selectedCount === 0 ? 'No keywords selected yet' : `${keywordCount(selectedCount, false)} selected`;
  }
  const group = groups.find((candidate) => candidate.id === scope.group_ids[0]);
  if (group === undefined) return 'No group chosen yet';
  return `${keywordCount(selectedCount, true)} in ${group.name}`;
}
