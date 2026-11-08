"""Google organic SERP over ``POST /v3/serp/google/organic/live/advanced``: the SEO pages' SERP panel.

``organic_serp``: desktop/Windows, depth clamped to 10-100 (DataForSEO bills per page of 10 and rejects other
depths), "No Search Results" = an empty, billed success. Items: ``type == 'organic'`` only, ``position`` =
``rank_group``, else ``rank_absolute`` (organic-only rank, what users count); ``item_types`` = distinct types of
every item, in order. The keyword is escaped with ``escape_keyword``: the endpoint decodes %-escapes.

The Google AI Overviews answer engine posts to the same endpoint and reads its organic items with
``organic_items``; its client lives with the other search clients (``lambda/search/google_ai_overview.py``).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from shared import dataforseo_client
from shared.dataforseo_client import TaskResult
from shared.dataforseo_keyword_rows import int_or_none, mapping_or_empty, object_list
from shared.dataforseo_locations import MarketCodes
from shared.dataforseo_pricing import clamp_serp_depth

__all__ = [
    'ORGANIC_LIVE_PATH',
    'OrganicItem',
    'SerpSnapshot',
    'item_types',
    'optional_string',
    'organic_items',
    'organic_serp',
    'serp_items',
]

#: The live organic SERP endpoint: the SEO pages' SERP panel and the Google AI Overviews client post to it.
ORGANIC_LIVE_PATH: Final = '/v3/serp/google/organic/live/advanced'
SERP_ANALYSIS_DEPTH: Final = 20


@dataclass(frozen=True)
class OrganicItem:
    """One organic Google result."""

    position: int
    rank_absolute: int | None
    url: str
    domain: str
    title: str
    description: str


@dataclass(frozen=True)
class SerpSnapshot:
    """Organic results of one Google search."""

    items: tuple[OrganicItem, ...]
    item_types: tuple[str, ...]
    check_url: str | None
    cost_usd: float


def _string(value: object) -> str:
    return value if isinstance(value, str) else ''


def optional_string(value: object) -> str | None:
    """``value`` when it is a string, else ``None``."""
    return value if isinstance(value, str) else None


def first_result(task: TaskResult) -> dict[str, Any] | None:
    """``task.result[0]`` when it is an object (``None`` for an empty or null result)."""
    first = task.result[0] if task.result else None
    return first if isinstance(first, dict) else None


def serp_items(result: Mapping[str, Any] | None) -> list[Mapping[str, Any]]:
    """The JSON objects of ``result.items`` (none when it is missing)."""
    return object_list(mapping_or_empty(result).get('items'))


def organic_items(items: Sequence[Mapping[str, Any]]) -> tuple[OrganicItem, ...]:
    """Organic items only, ranked by ``rank_group``, else ``rank_absolute``, else 0."""
    organic: list[OrganicItem] = []
    for item in items:
        if item.get('type') != 'organic':
            continue
        rank_absolute = int_or_none(item.get('rank_absolute'))
        rank_group = int_or_none(item.get('rank_group'))
        organic.append(OrganicItem(
            position=rank_group if rank_group is not None else rank_absolute or 0,
            rank_absolute=rank_absolute,
            url=_string(item.get('url')),
            domain=_string(item.get('domain')),
            title=_string(item.get('title')),
            description=_string(item.get('description')),
        ))
    return tuple(organic)


def item_types(items: Sequence[Mapping[str, Any]]) -> tuple[str, ...]:
    """Distinct ``type`` values of every item, in first-seen order."""
    return tuple(dict.fromkeys(kind for kind in (item.get('type') for item in items) if isinstance(kind, str) and kind))


def organic_body(keyword: str, codes: MarketCodes, depth: int) -> dict[str, Any]:
    """The SERP panel task: national ``location_code``, desktop/Windows."""
    return {
        'keyword': dataforseo_client.escape_keyword(keyword),
        'location_code': codes.location_code,
        'language_code': codes.language_code,
        'device': 'desktop',
        'os': 'windows',
        'depth': clamp_serp_depth(depth),
    }


def organic_serp(keyword: str, codes: MarketCodes, depth: int = SERP_ANALYSIS_DEPTH) -> SerpSnapshot:
    """The organic results of one Google search (an empty snapshot for "No Search Results")."""
    task = dataforseo_client.post_live(
        ORGANIC_LIVE_PATH, organic_body(keyword, codes, depth), treat_no_results_as_empty=True,
    )
    result = first_result(task)
    items = serp_items(result)
    return SerpSnapshot(
        items=organic_items(items),
        item_types=item_types(items),
        check_url=optional_string(result.get('check_url')) if result is not None else None,
        cost_usd=task.cost_usd,
    )
