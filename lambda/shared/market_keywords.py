"""Local keyword suggestions: one keyword as a local user in each market would ask it (2.37.0).

``POST /api/markets`` asks Bedrock (``ModelRole.GENERATION``) once for every
requested market. The keyword and the market descriptions are wrapped as
untrusted input (``shared.prompt_safety``); the answer is parsed as JSON and
only entries for the requested markets with valid keyword text survive.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from shared.keyword_store import validate_keyword_text
from shared.llm_json import parse_llm_json
from shared.markets import Market
from shared.models import ModelRole, invoke_bedrock
from shared.prompt_safety import untrusted_input_system_instruction, wrap_user_input

#: The most markets one suggestion request may name (one Bedrock call answers all of them).
MAX_SUGGESTION_MARKETS = 10
SUGGESTION_MAX_TOKENS = 2000


class UnparseableSuggestionsError(ValueError):
    """The model's output held no JSON object."""


def _market_brief(market: Market) -> dict[str, Any]:
    brief = {
        'market_id': market.market_id,
        'country': market.country_name,
        'language': f'{market.language_name} ({market.language})',
    }
    if market.city:
        brief['city'] = market.city
    return brief


def suggestion_prompt(keyword: str, markets: list[Market]) -> str:
    """The one prompt of a suggestion request: the keyword, the markets and the output contract."""
    briefs = json.dumps([_market_brief(market) for market in markets], ensure_ascii=False)
    return f"""{untrusted_input_system_instruction()}

You localize the questions a brand tracks in AI answer engines (ChatGPT, Perplexity, Gemini, Claude).
Keyword: {wrap_user_input(keyword, 'keyword')}
Markets: {wrap_user_input(briefs, 'markets')}

For each market, write the keyword the way a local user in that market would type it into an AI assistant:
- in the market's language and its local variant (vocabulary, spelling, idiom);
- with the same intent and the same level of detail, not a word-for-word translation;
- keep brand and product names as they are; adapt place names, currencies and units only where locals would;
- one line, at most 200 characters, no quotes.

Return only a JSON object, no prose:
{{"suggestions": [{{"market_id": "...", "keyword": "..."}}]}}
with exactly one entry per market, using the market_id values given above."""


def usable_suggestions(parsed: Mapping[str, Any], markets: list[Market]) -> list[dict[str, str]]:
    """The model's usable suggestions: one per requested market, valid keyword text, in request order."""
    proposed: dict[str, str] = {}
    entries = parsed.get('suggestions')
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict):
            continue
        market_id = entry.get('market_id')
        text, error = validate_keyword_text(entry.get('keyword'))
        if isinstance(market_id, str) and text and error is None:
            proposed.setdefault(market_id, text)
    return [
        {'market_id': market.market_id, 'keyword': proposed[market.market_id]}
        for market in markets
        if market.market_id in proposed
    ]


def suggest_local_keywords(keyword: str, markets: list[Market]) -> list[dict[str, str]]:
    """Ask the model once for ``keyword`` in every market; raises when the call fails or answers no JSON."""
    answer = invoke_bedrock(suggestion_prompt(keyword, markets), ModelRole.GENERATION, max_tokens=SUGGESTION_MAX_TOKENS)
    parsed = parse_llm_json(answer)
    if not isinstance(parsed, dict):
        raise UnparseableSuggestionsError('The model returned no JSON object')
    return usable_suggestions(parsed, markets)
