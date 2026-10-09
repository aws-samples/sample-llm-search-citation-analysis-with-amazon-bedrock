import {
  GLOBAL_MARKET_ID, type Keyword, type Market
} from '../../types';

/**
 * Pure helpers behind the header market selector: which choices it offers,
 * which stored or linked choice still applies, how a choice is named and
 * where it is remembered. A choice is a market id, `GLOBAL_MARKET_ID` for
 * the keywords without a market, or `null` for every market combined.
 */

export type MarketChoice = string | null;

/** Where the choice is remembered between visits. */
export const MARKET_STORAGE_KEY = 'market';
/** The report URL parameter carrying the choice, so a shared or printed report shows the same market. */
export const MARKET_SEARCH_PARAM = 'market';
/** The `<select>` value and URL value of "every market combined". */
export const ALL_MARKETS_VALUE = 'all';

export const ALL_MARKETS_LABEL = 'All markets (combined)';
export const NO_MARKET_LABEL = 'No market';

/** The market a keyword is asked from (`GLOBAL_MARKET_ID` without one). */
export function keywordMarketId(keyword: Pick<Keyword, 'market_id'>): string {
  if (keyword.market_id) return keyword.market_id;
  return GLOBAL_MARKET_ID;
}

/** Whether some keyword has no market, so "No market" is a choice worth offering. */
export function hasUnassignedKeywords(keywords: readonly Pick<Keyword, 'market_id'>[]): boolean {
  return keywords.some((keyword) => keywordMarketId(keyword) === GLOBAL_MARKET_ID);
}

export interface MarketChoiceOption {
  readonly value: string;
  readonly label: string;
}

/** The selector's options: combined first, each market, then "No market" when some keyword has none. */
export function marketChoiceOptions(markets: readonly Market[], includeUnassigned: boolean): MarketChoiceOption[] {
  return [
    {
      value: ALL_MARKETS_VALUE,
      label: ALL_MARKETS_LABEL,
    },
    ...markets.map((market) => ({
      value: market.market_id,
      label: market.name,
    })),
    ...(includeUnassigned ? [{
      value: GLOBAL_MARKET_ID,
      label: NO_MARKET_LABEL,
    }] : []),
  ];
}

/** The choice a `<select>` or URL value stands for. */
export function decodeMarketChoice(value: string | null): MarketChoice {
  return value === null || value === '' || value === ALL_MARKETS_VALUE ? null : value;
}

export function encodeMarketChoice(choice: MarketChoice): string {
  return choice ?? ALL_MARKETS_VALUE;
}

/**
 * The choice that applies: `choice` while the markets are still loading
 * (so a remembered market does not refetch every view once they arrive),
 * afterwards only when it names a configured market, or "No market" while
 * some keyword has none; every market combined otherwise.
 */
export function applicableMarketChoice(
  choice: MarketChoice, markets: readonly Market[], loaded: boolean, includeUnassigned: boolean
): MarketChoice {
  if (choice === null || !loaded) return choice;
  if (choice === GLOBAL_MARKET_ID) return includeUnassigned && markets.length > 0 ? choice : null;
  return markets.some((market) => market.market_id === choice) ? choice : null;
}

/** The display name of a market id ("No market" for the global one, the id itself for an unknown one). */
export function marketName(marketId: string, markets: readonly Market[]): string {
  if (marketId === GLOBAL_MARKET_ID) return NO_MARKET_LABEL;
  return markets.find((market) => market.market_id === marketId)?.name ?? marketId;
}

/**
 * `label · market` when the answer is narrowed to a market, `label` otherwise.
 * The read endpoints already end a narrowed label with `, market <id>`; that
 * suffix gives way to the market's name.
 */
export function withMarketLabel(label: string, marketId: string | null | undefined, markets: readonly Market[]): string {
  if (!marketId) return label;
  const idSuffix = `, market ${marketId}`;
  const base = label.endsWith(idSuffix) ? label.slice(0, -idSuffix.length) : label;
  return `${base} · ${marketName(marketId, markets)}`;
}

export function readStoredMarketChoice(): MarketChoice {
  try {
    return decodeMarketChoice(localStorage.getItem(MARKET_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeMarketChoice(choice: MarketChoice): void {
  try {
    if (choice === null) localStorage.removeItem(MARKET_STORAGE_KEY);
    else localStorage.setItem(MARKET_STORAGE_KEY, choice);
  } catch {
    // Storage can be unavailable (private mode, quota); the choice then lasts for the visit only.
  }
}
