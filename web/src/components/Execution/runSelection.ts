import type {
  AnalysisScope, Keyword
} from '../../types';
import type { ScopeMode } from '../Schedule/ScopeModeFields';
import {
  keywordsInMarkets, withMarketIds
} from '../Markets/marketScope';

/** What the Run Analysis panel will start: a keyword scope plus an optional market filter. */
export interface RunSelection {
  readonly mode: ScopeMode;
  readonly keywordIds: readonly string[];
  readonly groupIds: readonly string[];
  /** Empty = every market. */
  readonly marketIds: readonly string[];
}

/** The default: every active keyword in every market. */
export const EVERY_KEYWORD_RUN: RunSelection = {
  mode: 'all',
  keywordIds: [],
  groupIds: [],
  marketIds: [],
};

/**
 * The scope the trigger API receives. A plain run of every keyword in every
 * market sends no scope at all (the classic run), as it always has.
 */
export function runSelectionScope(selection: RunSelection): AnalysisScope | undefined {
  const { marketIds } = selection;
  if (selection.mode === 'keywords') return withMarketIds({
    mode: 'keywords',
    keyword_ids: [...selection.keywordIds],
  }, marketIds);
  if (selection.mode === 'groups') return withMarketIds({
    mode: 'groups',
    group_ids: [...selection.groupIds],
  }, marketIds);
  if (marketIds.length === 0) return undefined;
  return withMarketIds({ mode: 'all' }, marketIds);
}

/**
 * How many active keywords the run resolves to, by the same rules the API
 * uses: active only, narrowed to the ticked markets, and for groups every
 * active member of any selected group (a keyword in two groups counts once).
 */
export function runKeywordCount(selection: RunSelection, activeKeywords: readonly Keyword[]): number {
  if (selection.mode === 'keywords') return selection.keywordIds.length;
  const inMarkets = keywordsInMarkets(activeKeywords, selection.marketIds);
  if (selection.mode === 'all') return inMarkets.length;
  const groups = new Set(selection.groupIds);
  return inMarkets.filter((keyword) => (keyword.group_ids ?? []).some((groupId) => groups.has(groupId))).length;
}

/** "83 active keywords in every market" / "1 active keyword in Chile (Spanish), No market". */
export function describeRun(keywordCount: number, marketNames: readonly string[]): string {
  const keywords = `${keywordCount} active keyword${keywordCount === 1 ? '' : 's'}`;
  const where = marketNames.length === 0 ? 'every market' : marketNames.join(', ');
  return `${keywords} in ${where}`;
}
