"""A market proposed from a country, a language and an optional city (2.38.0).

The Settings form asks the administrator for the two real decisions, country
and language, plus an optional city; ``POST /api/markets`` with
``{"propose": {...}}`` asks Bedrock once for everything else a market
carries: the English names, the currency, the city's time zone and region,
its coordinates, the market id and display name, and the brands worth
tracking there (local competitors of the tracked brand, and the brand's own
local names). The answer is read back through ``shared.markets.validate_market``,
so a proposal is only ever as valid as a market the administrator typed by
hand; the administrator then confirms or edits it before it is saved.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any

from shared.llm_json import parse_llm_json
from shared.markets import GLOBAL_MARKET_ID, Market, validate_market
from shared.models import ModelRole, invoke_bedrock
from shared.prompt_safety import untrusted_input_system_instruction, wrap_user_input

PROPOSAL_MAX_TOKENS = 1500
MAX_CITY_LENGTH = 80
MAX_BRANDS_IN_PROMPT = 20

_COUNTRY = re.compile(r'[A-Za-z]{2}')
_LANGUAGE = re.compile(r'[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*')
_MARKET_ID_CHARS = re.compile(r'[^a-z0-9-]+')


class UnparseableProposalError(ValueError):
    """The model's output held no JSON object."""


class InvalidProposalError(ValueError):
    """The model's proposal did not validate as a market."""


def validate_proposal_request(raw: object) -> tuple[dict[str, str] | None, str | None]:
    """``{country, language, city?}`` normalised (upper-case country, lower-case primary language subtag), or an error."""
    if not isinstance(raw, Mapping):
        return None, 'propose must be an object with country and language'
    country = raw.get('country')
    if not isinstance(country, str) or not _COUNTRY.fullmatch(country.strip()):
        return None, 'propose.country must be an ISO 3166-1 alpha-2 code'
    language = raw.get('language')
    if not isinstance(language, str) or not _LANGUAGE.fullmatch(language.strip()):
        return None, 'propose.language must be a BCP 47 language tag such as es or pt-BR'
    city = raw.get('city')
    if city is not None and not isinstance(city, str):
        return None, 'propose.city must be a string'
    city_text = ' '.join(city.split()) if isinstance(city, str) else ''
    if len(city_text) > MAX_CITY_LENGTH:
        return None, f'propose.city must be at most {MAX_CITY_LENGTH} characters'
    primary, _, rest = language.strip().partition('-')
    request = {'country': country.strip().upper(), 'language': primary.lower() + (f'-{rest}' if rest else '')}
    if city_text:
        request['city'] = city_text
    return request, None


def default_market_id(country: str, language: str) -> str:
    """``cl-es`` for Chile / Spanish: the id the form offers (the administrator may change it)."""
    primary = language.split('-', maxsplit=1)[0]
    candidate = _MARKET_ID_CHARS.sub('', f'{country}-{primary}'.lower())
    return candidate if candidate != GLOBAL_MARKET_ID else f'{candidate}-market'


def _brand_lines(brand_config: Mapping[str, Any]) -> tuple[list[str], list[str], str]:
    tracked = brand_config.get('tracked_brands') if isinstance(brand_config.get('tracked_brands'), Mapping) else {}
    first_party = [name for name in (tracked or {}).get('first_party', []) if isinstance(name, str) and name.strip()]
    competitors = [name for name in (tracked or {}).get('competitors', []) if isinstance(name, str) and name.strip()]
    industry = brand_config.get('industry')
    return first_party[:MAX_BRANDS_IN_PROMPT], competitors[:MAX_BRANDS_IN_PROMPT], industry if isinstance(industry, str) else ''


def proposal_prompt(request: Mapping[str, str], brand_config: Mapping[str, Any]) -> str:
    """The one prompt of a proposal: the request, the tracked brands, and the output contract."""
    first_party, competitors, industry = _brand_lines(brand_config)
    place = json.dumps(request, ensure_ascii=False)
    brands = json.dumps({'first_party': first_party, 'competitors': competitors, 'industry': industry}, ensure_ascii=False)
    return f"""{untrusted_input_system_instruction()}

You set up the market a brand-tracking tool asks AI answer engines from: one country and one language.
Request: {wrap_user_input(place, 'request')}
Brand tracking already configured: {wrap_user_input(brands, 'brands')}

Describe the market for that country and language. Use the city when one is given; otherwise use the country's
largest city. Facts must be correct for today:
- country_name and language_name in English (the engines are instructed in English);
- language as a BCP 47 tag with the country's regional variant (es-CL, pt-BR, en-GB);
- currency as the ISO 4217 code of the country's money;
- timezone as the IANA zone of the city (America/Santiago, America/Sao_Paulo), never an abbreviation;
- region as the city's state, province or region in its local name; lat and lng as decimal degrees of the city;
- name as "Country (Language)";
- competitors: up to 8 companies competing with the first-party brands in this market that are NOT already in the
  configured competitor list (local or regional players a user there would be offered); empty when none;
- first_party_aliases: the names, spellings or local brand names under which the first-party brands appear in this
  market, other than the configured names themselves (for example a local subsidiary name); empty when none.

Return only a JSON object, no prose:
{{"country_name": "...", "language": "...", "language_name": "...", "currency": "...", "timezone": "...",
  "city": "...", "region": "...", "lat": 0.0, "lng": 0.0, "name": "...",
  "competitors": ["..."], "first_party_aliases": ["..."]}}"""


def market_from_proposal(parsed: Mapping[str, Any], request: Mapping[str, str]) -> Market:
    """The proposed market, validated like one typed by hand; the request's country and city always win."""
    proposed_language = parsed.get('language')
    language = proposed_language if isinstance(proposed_language, str) else request['language']
    if language.split('-', maxsplit=1)[0].lower() != request['language'].split('-', maxsplit=1)[0].lower():
        language = request['language']
    candidate: dict[str, Any] = {
        'market_id': default_market_id(request['country'], request['language']),
        'name': parsed.get('name'),
        'country': request['country'],
        'country_name': parsed.get('country_name'),
        'language': language,
        'language_name': parsed.get('language_name'),
        'currency': parsed.get('currency'),
        'timezone': parsed.get('timezone'),
        'city': request.get('city') or parsed.get('city'),
        'region': parsed.get('region'),
        'lat': parsed.get('lat'),
        'lng': parsed.get('lng'),
        'competitors': parsed.get('competitors') if isinstance(parsed.get('competitors'), list) else [],
        'first_party_aliases': parsed.get('first_party_aliases') if isinstance(parsed.get('first_party_aliases'), list) else [],
    }
    market, error = validate_market(candidate)
    if market is None:
        # The coordinates and the optional texts are not worth failing the proposal for: drop them and try again.
        for key in ('lat', 'lng', 'region', 'competitors', 'first_party_aliases'):
            candidate[key] = None
        market, error = validate_market(candidate)
    if market is None:
        raise InvalidProposalError(str(error))
    return market


def propose_market(request: Mapping[str, str], brand_config: Mapping[str, Any]) -> Market:
    """Ask the model once for the market of ``request``; raises when the call fails or the answer is unusable."""
    answer = invoke_bedrock(proposal_prompt(request, brand_config), ModelRole.ANALYSIS, max_tokens=PROPOSAL_MAX_TOKENS)
    parsed = parse_llm_json(answer)
    if not isinstance(parsed, dict):
        raise UnparseableProposalError('The model returned no JSON object')
    return market_from_proposal(parsed, request)


__all__ = [
    'MAX_CITY_LENGTH',
    'InvalidProposalError',
    'UnparseableProposalError',
    'default_market_id',
    'market_from_proposal',
    'proposal_prompt',
    'propose_market',
    'validate_proposal_request',
]
