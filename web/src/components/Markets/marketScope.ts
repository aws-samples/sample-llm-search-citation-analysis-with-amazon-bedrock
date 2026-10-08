import type {
  AnalysisScope, Keyword
} from '../../types';
import { keywordMarketId } from './marketSelection';

/**
 * The market part of a run or schedule scope: `market_ids` narrows any
 * mode to the keywords of those markets (`'global'` for keywords without
 * one); absent means every market.
 */

/** `scope` narrowed to `marketIds`; an empty list removes the narrowing. */
export function withMarketIds(scope: AnalysisScope, marketIds: readonly string[]): AnalysisScope {
  if (marketIds.length > 0) return {
    ...scope,
    market_ids: [...marketIds],
  };
  const everyMarket = { ...scope };
  delete everyMarket.market_ids;
  return everyMarket;
}

/** The markets a scope is narrowed to (empty = every market). */
export function scopeMarketIds(scope: AnalysisScope | null | undefined): readonly string[] {
  return scope?.market_ids ?? [];
}

/** The keywords a market filter keeps (every keyword when the filter is empty). */
export function keywordsInMarkets<TKeyword extends Pick<Keyword, 'market_id'>>(
  keywords: readonly TKeyword[], marketIds: readonly string[]
): TKeyword[] {
  if (marketIds.length === 0) return [...keywords];
  const wanted = new Set(marketIds);
  return keywords.filter((keyword) => wanted.has(keywordMarketId(keyword)));
}

/** "Markets: Chile, No market" for a narrowed scope; `null` when it covers every market. */
export function describeScopeMarkets(marketIds: readonly string[], nameOf: (marketId: string) => string): string | null {
  if (marketIds.length === 0) return null;
  return `Markets: ${marketIds.map(nameOf).join(', ')}`;
}
