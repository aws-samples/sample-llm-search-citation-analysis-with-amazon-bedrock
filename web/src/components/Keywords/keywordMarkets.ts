import type {
  Keyword, Market
} from '../../types';
import { keywordMarketId } from '../Markets/marketSelection';

/**
 * Pure helpers behind the keyword list's markets: the concept a keyword
 * localizes, its linked translations, the markets it can still be added to
 * and the create body of one localized keyword.
 */

/** The question a keyword asks: its source keyword's id, or its own when it localizes none. */
export function conceptIdOf(keyword: Pick<Keyword, 'id' | 'concept_id'>): string {
  if (keyword.concept_id) return keyword.concept_id;
  return keyword.id;
}

/** The other keywords asking the same question (the source and every translation of it). */
export function linkedKeywords(keyword: Keyword, keywords: readonly Keyword[]): Keyword[] {
  const concept = conceptIdOf(keyword);
  return keywords.filter((candidate) => candidate.id !== keyword.id && conceptIdOf(candidate) === concept);
}

/** The configured markets the question is not asked in yet (neither by `source` nor by a translation). */
export function marketsAvailableFor(source: Keyword, keywords: readonly Keyword[], markets: readonly Market[]): Market[] {
  const covered = new Set([source, ...linkedKeywords(source, keywords)].map(keywordMarketId));
  return markets.filter((market) => !covered.has(market.market_id));
}

export interface LocalizedKeywordBody {
  keyword: string;
  market_id: string;
  concept_id: string;
  group_ids?: string[];
}

/** The create body of `text`, asked in `marketId`, localizing `source` and joining its groups. */
export function localizedKeywordBody(text: string, source: Keyword, marketId: string): LocalizedKeywordBody {
  const groupIds = source.group_ids ?? [];
  return {
    keyword: text.trim(),
    market_id: marketId,
    concept_id: conceptIdOf(source),
    ...(groupIds.length > 0 ? { group_ids: [...groupIds] } : {}),
  };
}
