"""Google organic SERP over ``POST /v3/serp/google/organic/live/advanced``, two ways:

- ``organic_serp``: the SERP panel. Desktop/Windows, depth clamped to 10-100 (DataForSEO bills per
  page of 10 and rejects other depths), "No Search Results" = an empty, billed success. Items:
  ``type == 'organic'`` only, ``position`` = ``rank_group``, else ``rank_absolute`` (organic-only rank, what
  users count); ``item_types`` = distinct types of every item, in order.
- ``ai_overview_search``: the Google AI Overviews answer engine. Depth 10 with
  ``load_async_ai_overview`` (DataForSEO refunds the extra charge when no overview loads), a billed
  non-idempotent call: no HTTP 5xx or timeout retry (``idempotent=False``), 150 s timeout (live answers
  take up to 120 s). Only an in-body upstream failure (task status in ``UPSTREAM_FAILURE_STATUS_CODES``) is
  re-posted, at most twice, 3 s apart (``AI_ANSWER_ATTEMPTS``, ``AI_RETRY_DELAY_MS``). A page without an
  overview, an empty overview or "No Search Results" is ``no_answer``; every other failure raises
  ``DataForSeoError`` for the caller to record as an error row.

Both calls escape the keyword with ``escape_keyword``: they hit the same endpoint, which decodes %-escapes.

A ``no_answer`` result carries no citations (references of an empty overview are not an
answer's sources) and an upstream-failed attempt's cost, if any, is added to ``metadata['cost_usd']``.
"""

from __future__ import annotations

import hashlib
import logging
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from shared import dataforseo_client
from shared.dataforseo_ai_overview import citations_from, find_ai_overview, markdown_to_text, parse_ai_overview
from shared.dataforseo_client import UPSTREAM_FAILURE_STATUS_CODES, DataForSeoError, TaskResult
from shared.dataforseo_keyword_rows import int_or_none, mapping_or_empty, object_list
from shared.dataforseo_locations import MarketCodes
from shared.dataforseo_pricing import clamp_serp_depth

__all__ = [
    'AiOverviewResult',
    'OrganicItem',
    'SerpSnapshot',
    'ai_overview_search',
    'citations_from',
    'markdown_to_text',
    'organic_serp',
    'parse_ai_overview',
]

logger = logging.getLogger(__name__)

ORGANIC_LIVE_PATH = '/v3/serp/google/organic/live/advanced'
SERP_ANALYSIS_DEPTH = 20

AIO_DEPTH = 10
AIO_TIMEOUT_SECONDS = 150.0
AI_ANSWER_ATTEMPTS = 3
AI_RETRY_DELAY_SECONDS = 3.0
AIO_MODEL = 'google-serp'

#: Module-level so tests replace them instead of waiting.
_sleep = time.sleep
_clock = time.monotonic


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


@dataclass(frozen=True)
class AiOverviewResult:
    """The AI Overview (or its absence) of one Google search, with the organic top 10."""

    status: Literal['success', 'no_answer']
    answer_markdown: str | None
    answer_text: str
    citations: tuple[str, ...]
    organic: tuple[OrganicItem, ...]
    metadata: dict[str, Any]


def _string(value: object) -> str:
    return value if isinstance(value, str) else ''


def _optional_string(value: object) -> str | None:
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
        check_url=_optional_string(result.get('check_url')) if result is not None else None,
        cost_usd=task.cost_usd,
    )


def ai_overview_tag(query: str, codes: MarketCodes) -> str:
    """A stable correlation tag DataForSEO echoes back (log correlation only)."""
    digest = hashlib.sha256(f'{codes.location_code}:{codes.language_code}:{query}'.encode()).hexdigest()
    return f'aio:{digest[:16]}'


def ai_overview_payload(query: str, codes: MarketCodes) -> dict[str, Any]:
    """The ``google_ai_overview`` task; no device, os or ``location_name``."""
    return {
        'keyword': dataforseo_client.escape_keyword(query),
        'location_code': codes.location_code,
        'language_code': codes.language_code,
        'depth': AIO_DEPTH,
        'load_async_ai_overview': True,
        'tag': ai_overview_tag(query, codes),
    }


def _is_upstream_task_failure(error: DataForSeoError) -> bool:
    """DataForSEO returned the task and its backend failed it (HTTP 5xx and timeouts never match)."""
    return error.provider_status in UPSTREAM_FAILURE_STATUS_CODES


def _post_ai_overview(body: dict[str, Any]) -> tuple[TaskResult, int, float]:
    """(task, attempts, USD billed by failed attempts); re-posts only in-body upstream failures."""
    attempt = 1
    failed_cost = 0.0
    while True:
        try:
            task = dataforseo_client.post_live(
                ORGANIC_LIVE_PATH, body,
                idempotent=False, timeout_s=AIO_TIMEOUT_SECONDS, treat_no_results_as_empty=True,
            )
        except DataForSeoError as error:
            if attempt >= AI_ANSWER_ATTEMPTS or not _is_upstream_task_failure(error):
                if failed_cost:
                    error.cost_usd = (error.cost_usd or 0.0) + failed_cost
                raise
            failed_cost += error.cost_usd or 0.0
            logger.warning(
                'dataforseo.ai-overview upstream task failure %s (attempt %d of %d)',
                error.provider_status, attempt, AI_ANSWER_ATTEMPTS,
            )
            attempt += 1
            _sleep(AI_RETRY_DELAY_SECONDS)
        else:
            return task, attempt, failed_cost


def _readable_result(task: TaskResult) -> dict[str, Any] | None:
    """``result[0]`` (``None`` = no results page); raises when the shape cannot be read."""
    first = task.result[0] if task.result else None
    if first is None:
        return None
    if not isinstance(first, dict) or not isinstance(first.get('items', []), list | None):
        raise DataForSeoError('INTERNAL_ERROR', 'DataForSEO returned an unreadable SERP result',
                              cost_usd=task.cost_usd)
    return first


def _metadata(
    task: TaskResult, result: Mapping[str, Any] | None, codes: MarketCodes, *, attempts: int, cost_usd: float,
    latency_ms: int,
) -> dict[str, Any]:
    """The metadata stored on a Google AI Overviews SearchResults row."""
    row = mapping_or_empty(result)
    types = row.get('item_types')
    overview = find_ai_overview(result)
    asynchronous = overview.get('asynchronous_ai_overview') if overview is not None else None
    return {
        'model': AIO_MODEL,
        'latency_ms': latency_ms,
        'cost_usd': cost_usd,
        'location_code': codes.location_code,
        'language_code': codes.language_code,
        'check_url': _optional_string(row.get('check_url')),
        'datetime': _optional_string(row.get('datetime')),
        'item_types': [kind for kind in types if isinstance(kind, str)] if isinstance(types, list)
        else list(item_types(serp_items(result))),
        'asynchronous_ai_overview': asynchronous if isinstance(asynchronous, bool) else None,
        'dataforseo_task_id': _optional_string(task.task.get('id')),
        'attempts': attempts,
    }


def ai_overview_search(query: str, codes: MarketCodes) -> AiOverviewResult:
    """The AI Overview of one Google search for ``query`` in one market."""
    started = _clock()
    task, attempts, failed_cost = _post_ai_overview(ai_overview_payload(query, codes))
    try:
        result = None if task.no_results else _readable_result(task)
    except DataForSeoError as error:
        error.cost_usd = (error.cost_usd or 0.0) + failed_cost
        raise
    markdown, text, citations = parse_ai_overview(result)
    metadata = _metadata(
        task, result, codes, attempts=attempts, cost_usd=task.cost_usd + failed_cost,
        latency_ms=round((_clock() - started) * 1000),
    )
    answered = markdown is not None
    return AiOverviewResult(
        status='success' if answered else 'no_answer',
        answer_markdown=markdown,
        answer_text=text,
        citations=tuple(citations) if answered else (),
        organic=organic_items(serp_items(result)),
        metadata=metadata,
    )
