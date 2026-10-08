/**
 * Markets: the country and language a keyword is asked from
 * (`lambda/shared/markets.py`). A keyword without a `market_id` belongs to
 * the implicit global market and is asked as before markets existed.
 */

/** The implicit market of every keyword without a `market_id`. */
export const GLOBAL_MARKET_ID = 'global';

/** One configured market, as `GET /api/markets` returns it (`Market.to_json()`). */
export interface Market {
  market_id: string;
  name: string;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  country_name: string;
  /** BCP 47 tag, e.g. `es-CL`. */
  language: string;
  language_name: string;
  /** ISO 4217, upper case. */
  currency: string;
  /** IANA time zone id. */
  timezone: string;
  city?: string;
  region?: string;
  lat?: number;
  lng?: number;
  /** Competitors tracked in this market on top of the brand config's list. */
  competitors?: string[];
  /** Local names of the tracked brand in this market. */
  first_party_aliases?: string[];
}

/** `GET /api/markets` and a successful `PUT /api/markets`. */
export interface MarketsListing {
  markets: Market[];
  updated_at: string | null;
}

/** One proposal of `POST /api/markets`: the keyword as a local user in the market would type it. */
export interface MarketKeywordSuggestion {
  market_id: string;
  keyword: string;
}
