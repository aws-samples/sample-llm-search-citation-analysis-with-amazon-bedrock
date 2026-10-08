import {
  GLOBAL_MARKET_ID, type Market
} from '../../types';

/**
 * The market add/edit form: its string values, the client-side check that
 * mirrors `validate_market` in `lambda/shared/markets.py` (same rules, same
 * messages, same first-error order, so the server never refuses what the
 * form accepted) and the `Market` it saves.
 */

export const MAX_MARKETS = 50;
const MAX_BRAND_NAMES = 50;
const MAX_BRAND_NAME_LENGTH = 100;

const MARKET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/u;
const COUNTRY_PATTERN = /^[A-Z]{2}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const CONTROL_CHARACTER = /\p{C}/u;

type TextField = 'name' | 'country_name' | 'language_name' | 'city' | 'region';

const MAX_TEXT: Record<TextField, number> = {
  name: 80,
  country_name: 60,
  language_name: 40,
  city: 80,
  region: 80,
};

/** Every market member as an editable string (lists one name per line). */
export type MarketFormValues = { [TField in keyof Market]-?: string };

type Checked<TValue> = readonly [TValue, string | null];

export function emptyMarketFormValues(): MarketFormValues {
  return {
    market_id: '',
    name: '',
    country: '',
    country_name: '',
    language: '',
    language_name: '',
    currency: '',
    timezone: '',
    city: '',
    region: '',
    lat: '',
    lng: '',
    competitors: '',
    first_party_aliases: '',
  };
}

export function marketFormValues(market: Market): MarketFormValues {
  return {
    market_id: market.market_id,
    name: market.name,
    country: market.country,
    country_name: market.country_name,
    language: market.language,
    language_name: market.language_name,
    currency: market.currency,
    timezone: market.timezone,
    city: market.city ?? '',
    region: market.region ?? '',
    lat: market.lat === undefined ? '' : String(market.lat),
    lng: market.lng === undefined ? '' : String(market.lng),
    competitors: (market.competitors ?? []).join('\n'),
    first_party_aliases: (market.first_party_aliases ?? []).join('\n'),
  };
}

/** Runs of whitespace collapsed to one space, ends trimmed (Python's `' '.join(value.split())`). */
function collapseWhitespace(value: string): string {
  return value.trim().split(/\s+/u).filter(Boolean).join(' ');
}

function singleLine(value: string, key: TextField, required: boolean): Checked<string | null> {
  const text = collapseWhitespace(value);
  if (text === '') return required ? [null, `${key} is required`] : [null, null];
  if (CONTROL_CHARACTER.test(text)) return [null, `${key} must not contain control characters`];
  if (text.length > MAX_TEXT[key]) return [null, `${key} must be at most ${MAX_TEXT[key]} characters`];
  return [text, null];
}

function patterned(value: string, key: string, pattern: RegExp, upper = false): Checked<string> {
  const text = upper ? value.trim().toUpperCase() : value.trim();
  if (text === '') return ['', `${key} is required`];
  return pattern.test(text) ? [text, null] : ['', `${key} is not valid`];
}

/** Whether the browser knows `zone` as an IANA time zone. */
function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function timezone(value: string): Checked<string> {
  const zone = value.trim();
  if (zone === '') return ['', 'timezone is required'];
  return isTimeZone(zone) ? [zone, null] : ['', 'timezone must be an IANA time zone such as America/Santiago'];
}

function marketId(value: string): Checked<string> {
  if (!MARKET_ID_PATTERN.test(value)) return ['', 'market_id must be 2-32 lower-case letters, digits or dashes'];
  if (value === GLOBAL_MARKET_ID) return ['', `market_id '${GLOBAL_MARKET_ID}' is reserved`];
  return [value, null];
}

function coordinate(value: string, key: 'lat' | 'lng', limit: number): Checked<number | null> {
  const text = value.trim();
  if (text === '') return [null, null];
  const number = Number(text);
  if (!Number.isFinite(number)) return [null, `${key} must be a number`];
  if (number < -limit || number > limit) return [null, `${key} must be between -${limit} and ${limit}`];
  return [Math.round(number * 1e6) / 1e6, null];
}

/** One name per non-blank line, whitespace collapsed, case-insensitive duplicates dropped. */
function brandNames(value: string, key: 'competitors' | 'first_party_aliases'): Checked<string[]> {
  const lines = value.split('\n').map(collapseWhitespace).filter(Boolean);
  if (lines.length > MAX_BRAND_NAMES) return [[], `${key} must be a list of at most ${MAX_BRAND_NAMES} names`];
  if (lines.some((line) => line.length > MAX_BRAND_NAME_LENGTH)) {
    return [[], `${key} entries must be non-empty names of at most ${MAX_BRAND_NAME_LENGTH} characters`];
  }
  const names: string[] = [];
  for (const name of lines) {
    if (!names.some((kept) => kept.toLocaleLowerCase() === name.toLocaleLowerCase())) names.push(name);
  }
  return [names, null];
}

interface CheckedFields {
  readonly market_id: Checked<string>;
  readonly country: Checked<string>;
  readonly country_name: Checked<string | null>;
  readonly language: Checked<string>;
  readonly language_name: Checked<string | null>;
  readonly currency: Checked<string>;
  readonly timezone: Checked<string>;
  readonly name: Checked<string | null>;
  readonly city: Checked<string | null>;
  readonly region: Checked<string | null>;
  readonly lat: Checked<number | null>;
  readonly lng: Checked<number | null>;
  readonly competitors: Checked<string[]>;
  readonly first_party_aliases: Checked<string[]>;
}

/** Every field checked, in the order the server reports the first problem. */
function checkFields(values: MarketFormValues): CheckedFields {
  return {
    market_id: marketId(values.market_id.trim()),
    country: patterned(values.country, 'country', COUNTRY_PATTERN, true),
    country_name: singleLine(values.country_name, 'country_name', true),
    language: patterned(values.language, 'language', LANGUAGE_PATTERN),
    language_name: singleLine(values.language_name, 'language_name', true),
    currency: patterned(values.currency, 'currency', CURRENCY_PATTERN, true),
    timezone: timezone(values.timezone),
    name: singleLine(values.name, 'name', false),
    city: singleLine(values.city, 'city', false),
    region: singleLine(values.region, 'region', false),
    lat: coordinate(values.lat, 'lat', 90),
    lng: coordinate(values.lng, 'lng', 180),
    competitors: brandNames(values.competitors, 'competitors'),
    first_party_aliases: brandNames(values.first_party_aliases, 'first_party_aliases'),
  };
}

function firstProblem(fields: CheckedFields): string | null {
  const errors: readonly (string | null)[] = [
    fields.market_id[1], fields.country[1], fields.country_name[1], fields.language[1], fields.language_name[1],
    fields.currency[1], fields.timezone[1], fields.name[1], fields.city[1], fields.region[1], fields.lat[1],
    fields.lng[1], fields.competitors[1], fields.first_party_aliases[1],
  ];
  const problem = errors.find((error) => error !== null);
  if (problem !== undefined) return problem;
  return (fields.lat[0] === null) === (fields.lng[0] === null) ? null : 'lat and lng must be given together';
}

function toMarket(fields: CheckedFields): Market {
  const countryName = fields.country_name[0] ?? '';
  const languageName = fields.language_name[0] ?? '';
  const [lat] = fields.lat;
  const [lng] = fields.lng;
  const [city] = fields.city;
  const [region] = fields.region;
  const [competitors] = fields.competitors;
  const [aliases] = fields.first_party_aliases;
  return {
    market_id: fields.market_id[0],
    name: fields.name[0] ?? `${countryName} (${languageName})`,
    country: fields.country[0],
    country_name: countryName,
    language: fields.language[0],
    language_name: languageName,
    currency: fields.currency[0],
    timezone: fields.timezone[0],
    ...(city === null ? {} : { city }),
    ...(region === null ? {} : { region }),
    ...(lat === null || lng === null ? {} : {
      lat,
      lng,
    }),
    ...(competitors.length === 0 ? {} : { competitors }),
    ...(aliases.length === 0 ? {} : { first_party_aliases: aliases }),
  };
}

export type MarketFormResult =
  | {
    readonly market: Market;
    readonly error: null;
  }
  | {
    readonly market: null;
    readonly error: string;
  };

/**
 * The market the form describes, or the first problem with it. `others`
 * are the rest of the list (without the market being edited), so an id
 * already in use is refused before the save.
 */
export function marketFromForm(values: MarketFormValues, others: readonly Market[]): MarketFormResult {
  const fields = checkFields(values);
  const problem = firstProblem(fields);
  if (problem !== null) return {
    market: null,
    error: problem,
  };
  const market = toMarket(fields);
  if (others.some((other) => other.market_id === market.market_id)) {
    return {
      market: null,
      error: `market_id '${market.market_id}' is used twice`,
    };
  }
  return {
    market,
    error: null,
  };
}
