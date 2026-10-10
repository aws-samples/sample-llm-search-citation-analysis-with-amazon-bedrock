/**
 * Markets API client (Settings › Markets, the Keywords "Add to markets…"
 * action and the header market selector).
 *
 * `GET /markets` lists the configured markets for any signed-in user;
 * `PUT /markets` (Admin) replaces the list and refuses, with a 409 naming
 * them, to remove markets keywords still use; `POST /markets` (Admin) asks
 * Bedrock how a local user in each market would type a keyword. Refusal
 * bodies are read here (not flattened into a bare status by the shared
 * client) so the reason reaches the screen.
 */
import {
  apiGet, apiPost, apiPut
} from './client';
import {
  isFiniteNumber, isOptionalString, isOptionalStringArray, isRecord, isStringArray
} from './contentStudioDecoderPrimitives';
import { refusalMessage } from './providerModels';
import type {
  Market, MarketKeywordSuggestion, MarketProposal, MarketProposalRequest, MarketsListing
} from '../types';

const MARKETS_PATH = '/markets';

export class MarketsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketsError';
  }
}

/** The 409 of `PUT /markets`: keywords still use the markets the new list drops. */
export class MarketsInUseError extends MarketsError {
  readonly marketIds: readonly string[];

  constructor(message: string, marketIds: readonly string[]) {
    super(message);
    this.name = 'MarketsInUseError';
    this.marketIds = marketIds;
  }
}

const REQUIRED_TEXT_FIELDS = [
  'market_id', 'name', 'country', 'country_name', 'language', 'language_name', 'currency', 'timezone',
] as const;

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function isMarket(value: unknown): value is Market {
  return isRecord(value)
    && REQUIRED_TEXT_FIELDS.every((field) => typeof value[field] === 'string')
    && isOptionalString(value.city)
    && isOptionalString(value.region)
    && isOptionalNumber(value.lat)
    && isOptionalNumber(value.lng)
    && isOptionalStringArray(value.competitors)
    && isOptionalStringArray(value.first_party_aliases);
}

/** A copy holding only the members the dashboard knows, optional ones only when present. */
function toMarket(value: Market): Market {
  return {
    market_id: value.market_id,
    name: value.name,
    country: value.country,
    country_name: value.country_name,
    language: value.language,
    language_name: value.language_name,
    currency: value.currency,
    timezone: value.timezone,
    ...(value.city === undefined ? {} : { city: value.city }),
    ...(value.region === undefined ? {} : { region: value.region }),
    ...(value.lat === undefined || value.lng === undefined ? {} : {
      lat: value.lat,
      lng: value.lng,
    }),
    ...(value.competitors === undefined ? {} : { competitors: [...value.competitors] }),
    ...(value.first_party_aliases === undefined ? {} : { first_party_aliases: [...value.first_party_aliases] }),
  };
}

export function decodeMarketsListing(payload: unknown): MarketsListing {
  if (!isRecord(payload) || !Array.isArray(payload.markets) || !payload.markets.every(isMarket)) {
    throw new MarketsError('Markets API returned an invalid market list');
  }
  const updatedAt = payload.updated_at;
  if (!(updatedAt === undefined || updatedAt === null || typeof updatedAt === 'string')) {
    throw new MarketsError('Markets API returned an invalid market list');
  }
  return {
    markets: payload.markets.map(toMarket),
    updated_at: updatedAt ?? null,
  };
}

function isSuggestion(value: unknown): value is MarketKeywordSuggestion {
  return isRecord(value) && typeof value.market_id === 'string' && typeof value.keyword === 'string';
}

export function decodeMarketSuggestions(payload: unknown): MarketKeywordSuggestion[] {
  if (!isRecord(payload) || !Array.isArray(payload.suggestions) || !payload.suggestions.every(isSuggestion)) {
    throw new MarketsError('Markets API returned invalid suggestions');
  }
  return payload.suggestions.map((suggestion) => ({
    market_id: suggestion.market_id,
    keyword: suggestion.keyword,
  }));
}

export function decodeMarketProposal(payload: unknown): MarketProposal {
  if (!isRecord(payload) || !isMarket(payload.market) || typeof payload.market_id_taken !== 'boolean') {
    throw new MarketsError('Markets API returned an invalid market proposal');
  }
  return {
    market: toMarket(payload.market),
    market_id_taken: payload.market_id_taken,
  };
}

/** The error a refusal body stands for, or `null` when `payload` is not a refusal. */
function refusal(payload: unknown): MarketsError | null {
  const message = refusalMessage(payload);
  if (message === null) return null;
  if (isRecord(payload) && isStringArray(payload.market_ids)) return new MarketsInUseError(message, payload.market_ids);
  return new MarketsError(message);
}

export async function fetchMarkets(signal?: AbortSignal): Promise<MarketsListing> {
  return decodeMarketsListing(await apiGet<unknown>(MARKETS_PATH, { signal }));
}

/** Replace the whole market list; throws `MarketsInUseError` when keywords still use a dropped market. */
export async function saveMarkets(markets: readonly Market[]): Promise<MarketsListing> {
  const payload = await apiPut<unknown>(MARKETS_PATH, { markets }, { acceptedJsonStatuses: [400, 409] });
  const refused = refusal(payload);
  if (refused !== null) throw refused;
  return decodeMarketsListing(payload);
}

/** `POST /markets` with `body`, the refusal bodies thrown as errors: 400 names the refused field, 502 says the model could not answer. */
async function postMarkets(body: object, signal: AbortSignal | undefined): Promise<unknown> {
  const payload = await apiPost<unknown>(MARKETS_PATH, body, {
    signal,
    acceptedJsonStatuses: [400, 502],
  });
  const refused = refusal(payload);
  if (refused !== null) throw refused;
  return payload;
}

/** How a local user in each of `marketIds` would type `keyword` (local wording, not a literal translation). */
export async function suggestMarketKeywords(
  keyword: string, marketIds: readonly string[], signal?: AbortSignal
): Promise<MarketKeywordSuggestion[]> {
  return decodeMarketSuggestions(await postMarkets({
    keyword,
    market_ids: marketIds,
  }, signal));
}

/**
 * Ask Bedrock to describe the market of a country and language (and city): names, currency, time zone,
 * coordinates, local competitors and local brand names. The administrator confirms it before saving.
 */
export async function proposeMarket(request: MarketProposalRequest, signal?: AbortSignal): Promise<MarketProposal> {
  return decodeMarketProposal(await postMarkets({ propose: request }, signal));
}
