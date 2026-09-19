"""
Google keyword-expansion signals through SerpAPI.

The five optional search providers the search Lambda integrates (Brave,
Tavily, Exa, SerpAPI, Firecrawl) are plain "URLs + snippets for a query"
APIs — none of them expands keywords. SerpAPI is the exception in what it
*returns*: a Google result page carries Google's own expansion signals, and
the autocomplete engine exposes the suggestion box. The research agent uses
three of them, per planned query:

- ``related_searches``  — the "Related searches" block at the bottom of the page
- ``related_questions`` — "People also ask"
- ``google_autocomplete`` — the suggestions typed into the search box

They arrive as raw phrases (no intent or competition), so the agent records
them as candidates from provider ``serpapi`` and lets the evaluation and the
final selection score them next to the LLM providers' suggestions.

SerpAPI: https://serpapi.com/search-api (``related_searches``,
``related_questions``) and https://serpapi.com/google-autocomplete-api.
"""

from __future__ import annotations

import logging
from typing import Any

import requests

from shared.ai_clients import retry_with_backoff
from shared.utils import normalize_keyword

logger = logging.getLogger(__name__)

SERPAPI_ENDPOINT = 'https://serpapi.com/search'
SIGNAL_SOURCES = ('google related searches', 'people also ask', 'google autocomplete')
# Google returns at most ~8 related searches and ~4 questions per page and
# ~10 autocomplete entries; this bound only protects the job row size.
MAX_SIGNALS_PER_QUERY = 30
# Neutral score: the model scores these candidates later.
SIGNAL_RELEVANCE = 5


@retry_with_backoff('SERPAPI', max_retries=2, timeout=20)
def _serpapi_get(params: dict[str, Any], *, timeout: int = 20) -> requests.Response:
    return requests.get(SERPAPI_ENDPOINT, params=params, timeout=timeout)


def _phrase(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = ' '.join(value.split()).strip(' ?.!').lower()
    return text[:200] if text else None


def fetch_google_signals(api_key: str, query: str, *, country: str = 'us', language: str = 'en') -> list[dict[str, Any]]:
    """Related searches, People-Also-Ask questions and autocomplete for ``query``.

    Returns candidate entries in the research keyword shape
    (``keyword``, ``source``, ``relevance``) with no intent/competition, in
    the order Google lists them and de-duplicated on the canonical keyword
    identity. Network or API errors propagate — the step records them.
    """
    base = {'api_key': api_key, 'q': query, 'gl': country, 'hl': language}
    search = _serpapi_get({**base, 'engine': 'google', 'num': 10})
    autocomplete = _serpapi_get({**base, 'engine': 'google_autocomplete'})

    found: list[tuple[Any, str]] = []
    for item in search.get('related_searches') or []:
        if isinstance(item, dict):
            found.append((item.get('query'), SIGNAL_SOURCES[0]))
    for item in search.get('related_questions') or []:
        if isinstance(item, dict):
            found.append((item.get('question'), SIGNAL_SOURCES[1]))
    for item in autocomplete.get('suggestions') or []:
        if isinstance(item, dict):
            found.append((item.get('value'), SIGNAL_SOURCES[2]))

    seen: set[str] = set()
    candidates: list[dict[str, Any]] = []
    for raw, source in found:
        phrase = _phrase(raw)
        if not phrase:
            continue
        key = normalize_keyword(phrase)
        if not key or key in seen:
            continue
        seen.add(key)
        candidates.append({'keyword': phrase, 'source': source, 'relevance': SIGNAL_RELEVANCE, 'intent': '', 'competition': ''})
        if len(candidates) >= MAX_SIGNALS_PER_QUERY:
            break
    logger.info(f"SerpAPI signals for {query!r}: {len(candidates)} candidates")
    return candidates
