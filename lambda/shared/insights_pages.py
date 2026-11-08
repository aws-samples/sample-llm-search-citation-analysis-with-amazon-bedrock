"""
The long lists of the insight facts, listed first and paged (``GET /api/reports/insights``, 2.45.0 wave 5).

The facts hold every owned page (``owned_pages.pages``), every keyword's
prompt-by-engine row (``prompt_engine.keywords``) and every competitor
caveat reason (``caveat_reasons.reasons``; each ``competitor_caveats`` row
lists its first three and ``reasons_total``). An answer lists the first
``OWNED_PAGES_LIMIT`` pages, ``PROMPT_ENGINE_MAX_KEYWORDS`` keywords and no reason
(``listed_facts``: the facts the insights and the narrative rest on, with
``pages_omitted`` / ``omitted`` and the ``*_total`` counts), plus the token of
the next page (``with_page_tokens``); ``view=owned_pages`` /
``view=prompt_engine`` answers one page of the whole list (``facts_page``).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from shared.insights_citations import OWNED_PAGES_LIMIT
from shared.snapshot_artifacts import encode_snapshot_cursor

#: Keywords an answer's prompt-by-engine fact lists first, lowest visibility score first.
PROMPT_ENGINE_MAX_KEYWORDS = 50
#: Items a ``view=owned_pages`` / ``view=prompt_engine`` page holds.
FACTS_PAGE = 100
#: The paged views: the fact they page, its list and how many an answer lists first.
PAGED_FACTS = {
    'owned_pages': ('owned_pages', 'pages', OWNED_PAGES_LIMIT),
    'prompt_engine': ('prompt_engine', 'keywords', PROMPT_ENGINE_MAX_KEYWORDS),
    'caveat_reasons': ('caveat_reasons', 'reasons', 0),
}
#: The count of the rows an answer leaves out, per fact (the names the dashboard reads since 2.37).
_OMITTED = {'owned_pages': 'pages_omitted', 'prompt_engine': 'omitted', 'caveat_reasons': 'reasons_omitted'}


def listed_facts(facts: Mapping[str, Any]) -> dict[str, Any]:
    """``facts`` with each paged list cut to its first rows, the count left out and ``<list>_total``."""
    listed = dict(facts)
    for fact, items, first in PAGED_FACTS.values():
        if fact not in facts:
            continue
        rows = list(facts[fact][items])
        listed[fact] = {**facts[fact], items: rows[:first], _OMITTED[fact]: max(len(rows) - first, 0), f'{items}_total': len(rows)}
    return listed


def with_page_tokens(body: Mapping[str, Any], build_id: str) -> dict[str, Any]:
    """An answer whose listed facts carry ``<list>_next_token``: the next page of the whole list in ``build_id``."""
    facts = dict(body['facts'])
    for fact, items, first in PAGED_FACTS.values():
        if fact in facts:
            facts[fact] = {**facts[fact], f'{items}_next_token': encode_snapshot_cursor(first, int(facts[fact][f'{items}_total']), build_id)}
    return {**body, 'facts': facts}


def facts_page(facts: Mapping[str, Any], view: str, offset: int, build_id: str) -> dict[str, Any]:
    """One ``view`` page of the whole list (``FACTS_PAGE`` rows from ``offset``) as ``{'facts': {fact: {...}}}``.

    The page carries its ``<list>_total`` and ``next_token``; a prompt-by-engine
    page also its ``engines`` (the columns of every row).
    """
    fact, items, _first = PAGED_FACTS[view]
    rows = list(facts[fact][items])
    page: dict[str, Any] = {
        items: [dict(row) for row in rows[offset:offset + FACTS_PAGE]],
        f'{items}_total': len(rows),
        'next_token': encode_snapshot_cursor(offset + FACTS_PAGE, len(rows), build_id),
    }
    if fact == 'prompt_engine':
        page['engines'] = list(facts[fact]['engines'])
    return {'facts': {fact: page}}


__all__ = ['FACTS_PAGE', 'PAGED_FACTS', 'PROMPT_ENGINE_MAX_KEYWORDS', 'facts_page', 'listed_facts', 'with_page_tokens']
