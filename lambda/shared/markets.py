"""Markets: the country and language a keyword is asked from.

A market is one country plus one language (the model Writesonic and Peec AI
use). Each keyword belongs to at most one market (``market_id`` on the
Keywords row); a keyword without one belongs to the implicit global market
and is asked exactly as before markets existed. Keyword text is unique, so a
SearchResults partition (one keyword) is always single-market and a market
filter is a keyword filter.

How an analysis run uses a market (proven against the live APIs in 2.37.0):

* AI engines get a short instructions block (``market_instructions``) in their
  system channel. No engine has an answer-language parameter; this block is
  what changes the answer's language, currency and competitor set.
* AI engines also get their native location hint where one exists (OpenAI and
  Claude ``user_location``, Perplexity ``user_location`` with lat/long). The
  hint steers the search backend, not the answer.
* Search providers only get their native country/language parameters. They
  localize weakly unless the keyword itself is in the market's language.

The market list is one item (``config_id = 'markets'``) in the BrandConfig
table, so no AWS resource is added for it.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

GLOBAL_MARKET_ID = 'global'
"""The implicit market of every keyword without a ``market_id``."""

MARKETS_CONFIG_ID = 'markets'
"""The BrandConfig item holding the market list."""

MAX_MARKETS = 50
MAX_BRAND_NAMES = 50

_MARKET_ID = re.compile(r'[a-z0-9][a-z0-9-]{1,31}')
_COUNTRY = re.compile(r'[A-Z]{2}')
_CURRENCY = re.compile(r'[A-Z]{3}')
_LANGUAGE = re.compile(r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*')
_MAX_TEXT = {'name': 80, 'country_name': 60, 'language_name': 40, 'city': 80, 'region': 80}
_MAX_BRAND_NAME = 100

# Tavily's `country` boost takes one of these lowercase English names (topic
# "general" only); any other value is refused with a 400, so a market whose
# country name is not listed simply sends no Tavily country.
TAVILY_COUNTRIES = frozenset({
    'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'argentina', 'armenia', 'australia', 'austria',
    'azerbaijan', 'bahamas', 'bahrain', 'bangladesh', 'barbados', 'belarus', 'belgium', 'belize', 'benin', 'bhutan',
    'bolivia', 'bosnia and herzegovina', 'botswana', 'brazil', 'brunei', 'bulgaria', 'burkina faso', 'burundi',
    'cambodia', 'cameroon', 'canada', 'cape verde', 'central african republic', 'chad', 'chile', 'china', 'colombia',
    'comoros', 'congo', 'costa rica', 'croatia', 'cuba', 'cyprus', 'czech republic', 'denmark', 'djibouti',
    'dominican republic', 'ecuador', 'egypt', 'el salvador', 'equatorial guinea', 'eritrea', 'estonia', 'ethiopia',
    'fiji', 'finland', 'france', 'gabon', 'gambia', 'georgia', 'germany', 'ghana', 'greece', 'guatemala', 'guinea',
    'haiti', 'honduras', 'hungary', 'iceland', 'india', 'indonesia', 'iran', 'iraq', 'ireland', 'israel', 'italy',
    'jamaica', 'japan', 'jordan', 'kazakhstan', 'kenya', 'kuwait', 'kyrgyzstan', 'latvia', 'lebanon', 'lesotho',
    'liberia', 'libya', 'liechtenstein', 'lithuania', 'luxembourg', 'madagascar', 'malawi', 'malaysia', 'maldives',
    'mali', 'malta', 'mauritania', 'mauritius', 'mexico', 'moldova', 'monaco', 'mongolia', 'montenegro', 'morocco',
    'mozambique', 'myanmar', 'namibia', 'nepal', 'netherlands', 'new zealand', 'nicaragua', 'niger', 'nigeria',
    'north korea', 'north macedonia', 'norway', 'oman', 'pakistan', 'panama', 'papua new guinea', 'paraguay', 'peru',
    'philippines', 'poland', 'portugal', 'qatar', 'romania', 'russia', 'rwanda', 'saudi arabia', 'senegal', 'serbia',
    'singapore', 'slovakia', 'slovenia', 'somalia', 'south africa', 'south korea', 'south sudan', 'spain',
    'sri lanka', 'sudan', 'sweden', 'switzerland', 'syria', 'taiwan', 'tajikistan', 'tanzania', 'thailand', 'togo',
    'trinidad and tobago', 'tunisia', 'turkey', 'turkmenistan', 'uganda', 'ukraine', 'united arab emirates',
    'united kingdom', 'united states', 'uruguay', 'uzbekistan', 'venezuela', 'vietnam', 'yemen', 'zambia', 'zimbabwe',
})


@dataclass(frozen=True)
class Market:
    """One market: where a keyword's answers are asked from."""

    market_id: str
    name: str
    country: str
    """ISO 3166-1 alpha-2, upper case."""
    country_name: str
    language: str
    """BCP 47 tag, e.g. ``es-CL``."""
    language_name: str
    currency: str
    """ISO 4217, upper case."""
    timezone: str
    """IANA time zone id."""
    city: str | None = None
    region: str | None = None
    lat: float | None = None
    lng: float | None = None
    competitors: tuple[str, ...] = field(default=())
    """Competitors tracked in this market on top of the brand config's list."""
    first_party_aliases: tuple[str, ...] = field(default=())
    """Local names of the tracked brand in this market (e.g. "Altiplano Linhas Aéreas")."""

    @property
    def lang(self) -> str:
        """The ISO 639-1 primary subtag (``es`` from ``es-CL``)."""
        return self.language.split('-')[0].lower()

    def to_item(self) -> dict[str, Any]:
        """The JSON/DynamoDB form (``Decimal`` coordinates, optional fields omitted when empty)."""
        item: dict[str, Any] = {
            'market_id': self.market_id,
            'name': self.name,
            'country': self.country,
            'country_name': self.country_name,
            'language': self.language,
            'language_name': self.language_name,
            'currency': self.currency,
            'timezone': self.timezone,
        }
        for key in ('city', 'region'):
            value = getattr(self, key)
            if value:
                item[key] = value
        if self.lat is not None and self.lng is not None:
            item['lat'] = Decimal(str(self.lat))
            item['lng'] = Decimal(str(self.lng))
        if self.competitors:
            item['competitors'] = list(self.competitors)
        if self.first_party_aliases:
            item['first_party_aliases'] = list(self.first_party_aliases)
        return item

    def to_json(self) -> dict[str, Any]:
        """``to_item`` with plain floats (API responses, Step Functions payloads)."""
        item = self.to_item()
        if 'lat' in item:
            item['lat'] = float(item['lat'])
            item['lng'] = float(item['lng'])
        return item


def _single_line(value: object, key: str, *, required: bool) -> tuple[str | None, str | None]:
    """A trimmed one-line text field, or ``(None, error)``. Control characters never reach a prompt."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return (None, f'{key} is required') if required else (None, None)
    if not isinstance(value, str):
        return None, f'{key} must be a string'
    text = ' '.join(value.split())
    if any(unicodedata.category(char).startswith('C') for char in text):
        return None, f'{key} must not contain control characters'
    if len(text) > _MAX_TEXT[key]:
        return None, f'{key} must be at most {_MAX_TEXT[key]} characters'
    return text, None


def _brand_names(value: object, key: str) -> tuple[tuple[str, ...] | None, str | None]:
    if value is None:
        return (), None
    if not isinstance(value, list | tuple) or len(value) > MAX_BRAND_NAMES:
        return None, f'{key} must be a list of at most {MAX_BRAND_NAMES} names'
    names: list[str] = []
    for raw in value:
        if not isinstance(raw, str) or not raw.strip() or len(raw.strip()) > _MAX_BRAND_NAME:
            return None, f'{key} entries must be non-empty names of at most {_MAX_BRAND_NAME} characters'
        name = ' '.join(raw.split())
        if name.casefold() not in {kept.casefold() for kept in names}:
            names.append(name)
    return tuple(names), None


def _coordinate(value: object, key: str, limit: int) -> tuple[float | None, str | None]:
    if value is None or value == '':
        return None, None
    if isinstance(value, bool) or not isinstance(value, int | float | Decimal | str):
        return None, f'{key} must be a number'
    try:
        number = float(value)
    except ValueError:
        return None, f'{key} must be a number'
    if not -limit <= number <= limit:
        return None, f'{key} must be between -{limit} and {limit}'
    return round(number, 6), None


def _pattern(value: object, key: str, pattern: re.Pattern[str], *, upper: bool = False) -> tuple[str | None, str | None]:
    if not isinstance(value, str):
        return None, f'{key} is required'
    text = value.strip().upper() if upper else value.strip()
    if not pattern.fullmatch(text):
        return None, f'{key} is not valid'
    return text, None


def _timezone(value: object) -> tuple[str | None, str | None]:
    if not isinstance(value, str) or not value.strip():
        return None, 'timezone is required'
    try:
        ZoneInfo(value.strip())
    except (ZoneInfoNotFoundError, ValueError):
        return None, 'timezone must be an IANA time zone such as America/Santiago'
    return value.strip(), None


def _market_id(value: object) -> tuple[str | None, str | None]:
    if not isinstance(value, str) or not _MARKET_ID.fullmatch(value):
        return None, 'market_id must be 2-32 lower-case letters, digits or dashes'
    if value == GLOBAL_MARKET_ID:
        return None, f"market_id '{GLOBAL_MARKET_ID}' is reserved"
    return value, None


def _first_error(*checks: tuple[Any, str | None]) -> str | None:
    return next((error for _value, error in checks if error), None)


def validate_market(raw: object) -> tuple[Market | None, str | None]:
    """Validate one market object; ``(market, None)`` or ``(None, error)``."""
    if not isinstance(raw, Mapping):
        return None, 'market must be an object'
    market_id = _market_id(raw.get('market_id'))
    country = _pattern(raw.get('country'), 'country', _COUNTRY, upper=True)
    country_name = _single_line(raw.get('country_name'), 'country_name', required=True)
    language = _pattern(raw.get('language'), 'language', _LANGUAGE)
    language_name = _single_line(raw.get('language_name'), 'language_name', required=True)
    currency = _pattern(raw.get('currency'), 'currency', _CURRENCY, upper=True)
    timezone = _timezone(raw.get('timezone'))
    name = _single_line(raw.get('name'), 'name', required=False)
    city = _single_line(raw.get('city'), 'city', required=False)
    region = _single_line(raw.get('region'), 'region', required=False)
    lat = _coordinate(raw.get('lat'), 'lat', 90)
    lng = _coordinate(raw.get('lng'), 'lng', 180)
    competitors = _brand_names(raw.get('competitors'), 'competitors')
    aliases = _brand_names(raw.get('first_party_aliases'), 'first_party_aliases')
    error = _first_error(market_id, country, country_name, language, language_name, currency, timezone,
                         name, city, region, lat, lng, competitors, aliases)
    if error:
        return None, error
    if (lat[0] is None) != (lng[0] is None):
        return None, 'lat and lng must be given together'
    return Market(
        market_id=str(market_id[0]),
        name=name[0] or f'{country_name[0]} ({language_name[0]})',
        country=str(country[0]),
        country_name=str(country_name[0]),
        language=str(language[0]),
        language_name=str(language_name[0]),
        currency=str(currency[0]),
        timezone=str(timezone[0]),
        city=city[0],
        region=region[0],
        lat=lat[0],
        lng=lng[0],
        competitors=competitors[0] or (),
        first_party_aliases=aliases[0] or (),
    ), None


def validate_markets(raw: object) -> tuple[list[Market] | None, str | None]:
    """Validate a whole market list (unique ids, at most ``MAX_MARKETS``)."""
    if not isinstance(raw, list):
        return None, 'markets must be a list'
    if len(raw) > MAX_MARKETS:
        return None, f'At most {MAX_MARKETS} markets are allowed'
    markets: list[Market] = []
    for index, entry in enumerate(raw, start=1):
        market, error = validate_market(entry)
        if market is None:
            return None, f'Market {index}: {error}'
        if any(kept.market_id == market.market_id for kept in markets):
            return None, f"Market {index}: market_id '{market.market_id}' is used twice"
        markets.append(market)
    return markets, None


def markets_from_item(item: Mapping[str, Any] | None) -> list[Market]:
    """The valid markets of the stored item (an invalid stored entry is skipped, never raised)."""
    entries = (item or {}).get('markets')
    if not isinstance(entries, list):
        return []
    return [market for market in (validate_market(entry)[0] for entry in entries) if market is not None]


def load_markets(brand_config_table: Any) -> list[Market]:
    """Every configured market, in the order the administrator saved them."""
    return markets_from_item(brand_config_table.get_item(Key={'config_id': MARKETS_CONFIG_ID}).get('Item'))


def markets_by_id(markets: Iterable[Market]) -> dict[str, Market]:
    return {market.market_id: market for market in markets}


def keyword_market_id(item: Mapping[str, Any]) -> str:
    """The market a Keywords row belongs to (``GLOBAL_MARKET_ID`` without one)."""
    value = item.get('market_id')
    return value if isinstance(value, str) and value else GLOBAL_MARKET_ID


def is_market_filter_id(value: object) -> bool:
    """Whether ``value`` can name a market in a filter: a market id, or ``GLOBAL_MARKET_ID``.

    Only the format is checked; an id no market carries simply matches no keyword.
    """
    return isinstance(value, str) and (value == GLOBAL_MARKET_ID or _MARKET_ID.fullmatch(value) is not None)


def market_scoped_key(key: str, market_id: str | None) -> str:
    """``key`` for the global market (or none), ``f'{key}#{market_id}'`` for any other.

    The per-market partition of something that existed before markets (a KPI
    snapshot's ``group_id``, a narrative's ``scope_key``): the global market
    keeps the old key, so its history continues.
    """
    return key if market_id in (None, GLOBAL_MARKET_ID) else f'{key}#{market_id}'


def markets_item(markets: Iterable[Market], updated_at: str) -> dict[str, Any]:
    """The BrandConfig item that stores ``markets`` (``load_markets`` reads it back)."""
    return {
        'config_id': MARKETS_CONFIG_ID,
        'markets': [market.to_item() for market in markets],
        'updated_at': updated_at,
    }


def market_from_payload(payload: object) -> Market | None:
    """The market a workflow event carries, re-validated (the search Lambda treats it as untrusted)."""
    if payload is None:
        return None
    market, _error = validate_market(payload)
    return market


# ---------------------------------------------------------------------------
# What each provider receives
# ---------------------------------------------------------------------------

def market_instructions(market: Market) -> str:
    """The system/instructions block every AI engine gets for ``market``.

    Kept out of the user turn so the keyword text stays the measured prompt.
    """
    where = f'{market.city}, {market.country_name}' if market.city else market.country_name
    return (
        f'The user is located in {where} ({market.timezone}).\n'
        f'Respond in {market.language_name} ({market.language}). Express prices in {market.currency}.\n'
        f'Prefer sources and options relevant to users in {market.country_name}.'
    )


def _compact(values: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


def openai_user_location(market: Market) -> dict[str, Any]:
    """OpenAI ``web_search.user_location`` (approximate; country, city, region, timezone)."""
    return _compact({'type': 'approximate', 'country': market.country, 'city': market.city,
                     'region': market.region, 'timezone': market.timezone})


def claude_user_location(market: Market) -> dict[str, Any]:
    """Claude ``web_search.user_location``: the same fields as OpenAI's."""
    return openai_user_location(market)


def perplexity_user_location(market: Market) -> dict[str, Any]:
    """Perplexity Agent API ``web_search.user_location`` (lat/long only together with the country, always set)."""
    return _compact({'country': market.country, 'region': market.region, 'city': market.city,
                     'latitude': market.lat, 'longitude': market.lng})


def brave_params(market: Market) -> dict[str, Any]:
    """Brave ``country`` + ``search_lang`` (Portuguese is ``pt-br``/``pt-pt``, other languages the bare code)."""
    search_lang = market.language.lower() if market.lang == 'pt' and '-' in market.language else market.lang
    return {'country': market.country, 'search_lang': search_lang}


def tavily_params(market: Market) -> dict[str, Any]:
    """Tavily ``country`` (only a name Tavily lists) + ``language``."""
    country = market.country_name.casefold()
    return {'language': market.lang, **({'country': country} if country in TAVILY_COUNTRIES else {})}


def exa_params(market: Market) -> dict[str, Any]:
    return {'userLocation': market.country}


def serpapi_params(market: Market) -> dict[str, Any]:
    return {'gl': market.country.lower(), 'hl': market.lang}


def firecrawl_params(market: Market) -> dict[str, Any]:
    location = f'{market.city},{market.country_name}' if market.city else market.country_name
    return {'country': market.country, 'lang': market.lang, 'location': location}


# ---------------------------------------------------------------------------
# Brand tracking per market
# ---------------------------------------------------------------------------

def brand_config_for_market(config: Mapping[str, Any] | None, market: Market | None) -> dict[str, Any]:
    """The brand config with ``market``'s competitors and first-party aliases added to the tracked lists."""
    merged = dict(config or {})
    if market is None or not (market.competitors or market.first_party_aliases):
        return merged
    tracked = dict(merged.get('tracked_brands') or {})

    def extended(names: object, extra: tuple[str, ...]) -> list[str]:
        kept = [name for name in names if isinstance(name, str)] if isinstance(names, list) else []
        seen = {name.casefold() for name in kept}
        return kept + [name for name in extra if name.casefold() not in seen]

    tracked['first_party'] = extended(tracked.get('first_party'), market.first_party_aliases)
    tracked['competitors'] = extended(tracked.get('competitors'), market.competitors)
    merged['tracked_brands'] = tracked
    return merged


__all__ = [
    'GLOBAL_MARKET_ID',
    'MARKETS_CONFIG_ID',
    'MAX_MARKETS',
    'TAVILY_COUNTRIES',
    'Market',
    'brand_config_for_market',
    'brave_params',
    'claude_user_location',
    'exa_params',
    'firecrawl_params',
    'is_market_filter_id',
    'keyword_market_id',
    'load_markets',
    'market_from_payload',
    'market_instructions',
    'market_scoped_key',
    'markets_by_id',
    'markets_from_item',
    'markets_item',
    'openai_user_location',
    'perplexity_user_location',
    'serpapi_params',
    'tavily_params',
    'validate_market',
    'validate_markets',
]
