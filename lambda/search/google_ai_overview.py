"""Google AI Overviews client: the AI Overview on a Google results page, read through DataForSEO's SERP API.

An answer engine (``provider_type`` ``llm``): the overview is the answer, its references the citations. It is
asked the plain keyword once per keyword and run (``shared.config.ProviderDefinition.asks_plain_keyword``).

``ai_overview_search`` posts ``POST /v3/serp/google/organic/live/advanced`` at depth 10 with
``load_async_ai_overview`` (DataForSEO refunds the extra charge when no overview loads). It is a billed,
non-idempotent call: no HTTP 5xx or timeout retry (``idempotent=False``), 150 s timeout (live answers take up to
120 s). Only an in-body upstream failure (task status in ``UPSTREAM_FAILURE_STATUS_CODES``) is re-posted, at most
twice, 3 s apart (``AI_ANSWER_ATTEMPTS``, ``AI_RETRY_DELAY_SECONDS``). A page without an overview, an empty
overview or "No Search Results" is ``no_answer``; every other failure raises ``DataForSeoError``, which
``query_google_ai_overview`` turns into an error row. A ``no_answer`` result carries no citations (references of
an empty overview are not an answer's sources), and an upstream-failed attempt's cost, if any, is added to
``metadata['cost_usd']``.

The SEO pages' organic SERP panel shares the endpoint and the organic-item reading (``shared.dataforseo_serp``).
"""

from __future__ import annotations

import hashlib
import logging
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from ai_overview_answer import find_ai_overview, parse_ai_overview
from provider_result import ProviderResult, provider_error_result

from shared import dataforseo_client
from shared.config import Provider
from shared.dataforseo_client import UPSTREAM_FAILURE_STATUS_CODES, DataForSeoError, TaskResult
from shared.dataforseo_keyword_rows import mapping_or_empty
from shared.dataforseo_locations import MarketCodes, UnsupportedMarketError, market_codes
from shared.dataforseo_serp import (
    ORGANIC_LIVE_PATH,
    OrganicItem,
    item_types,
    optional_string,
    organic_items,
    serp_items,
)
from shared.markets import Market

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

AIO_DEPTH = 10
AIO_TIMEOUT_SECONDS = 150.0
AI_ANSWER_ATTEMPTS = 3
AI_RETRY_DELAY_SECONDS = 3.0
AIO_MODEL = 'google-serp'

#: The organic results kept on an AI Overviews row (the SERP is fetched at depth 10).
AIO_ORGANIC_LIMIT = 10

#: ``error_category`` of a market DataForSEO cannot localise: nothing was sent, nothing billed.
UNSUPPORTED_MARKET = 'unsupported_market'

#: Seconds one call may take: one live SERP call, never re-sent (billed), within its own timeout.
CALL_WORST_CASE_SECONDS = AIO_TIMEOUT_SECONDS

#: Module-level so tests replace them instead of waiting.
_sleep = time.sleep
_clock = time.monotonic


@dataclass(frozen=True)
class AiOverviewResult:
    """The AI Overview (or its absence) of one Google search, with the organic top 10."""

    status: Literal['success', 'no_answer']
    answer_markdown: str | None
    answer_text: str
    citations: tuple[str, ...]
    organic: tuple[OrganicItem, ...]
    metadata: dict[str, Any]
    raw_result: dict[str, Any] | None = None
    """DataForSEO's task ``result[0]`` as returned (``None`` for a results page without results): the Bronze answer."""


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
        'check_url': optional_string(row.get('check_url')),
        'datetime': optional_string(row.get('datetime')),
        'item_types': [kind for kind in types if isinstance(kind, str)] if isinstance(types, list)
        else list(item_types(serp_items(result))),
        'asynchronous_ai_overview': asynchronous if isinstance(asynchronous, bool) else None,
        'dataforseo_task_id': optional_string(task.task.get('id')),
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
        raw_result=result,
    )


# --- The provider result the search handler stores ----------------------------


def _aio_search_result(item: OrganicItem) -> dict[str, Any]:
    """One organic result as an entry of a SearchResults row's ``search_results``."""
    return {
        "url": item.url,
        "title": item.title,
        "snippet": item.description,
        "position": item.position,
        "domain": item.domain,
        "rank_absolute": item.rank_absolute,
        "source": Provider.GOOGLE_AI_OVERVIEW,
    }


def aio_result(overview: AiOverviewResult, query: str) -> ProviderResult:
    """The row of an answered (``success``) or overview-less (``no_answer``) results page for ``query``."""
    organic = [_aio_search_result(item) for item in overview.organic[:AIO_ORGANIC_LIMIT]]
    return {
        "provider": Provider.GOOGLE_AI_OVERVIEW,
        "query": query,
        "provider_type": "llm",
        "response": overview.answer_text,
        "citations": list(overview.citations),
        "status": overview.status,
        "search_results": organic,
        # Bronze: DataForSEO's task result as returned (D2), so the overview's references can be read again (D3).
        # The rendered markdown is kept beside it; the row's `response` is the plain prose brands are read from.
        "raw_response": {"dataforseo_result": overview.raw_result},
        "answer_markdown": overview.answer_markdown,
        "metadata": overview.metadata,
    }


def _aio_error(error: Exception, query: str, start_time: float, **fields: Any) -> ProviderResult:
    """The error row of a failed AI Overviews call for ``query``, with ``fields`` (``error_code``,
    ``error_category``) added."""
    result = provider_error_result(Provider.GOOGLE_AI_OVERVIEW, AIO_MODEL, error, start_time)
    return {**result, "provider_type": "llm", "query": query, **fields}


def query_google_ai_overview(query: str, market: Market | None = None) -> ProviderResult:
    """The AI Overview Google shows for ``query`` (the plain keyword) in ``market``.

    A market DataForSEO cannot localise is an error row with ``error_category``
    ``unsupported_market`` and no call. A DataForSEO failure keeps its
    ``DataForSeoError.code`` as ``error_code`` (provider health maps it) and
    any billed cost in ``metadata.cost_usd``.
    """
    start_time = time.time()
    try:
        codes = market_codes(market)
    except UnsupportedMarketError as error:
        logger.info('Google AI Overviews skipped: %s', error)
        return _aio_error(error, query, start_time, error_category=UNSUPPORTED_MARKET)
    try:
        overview = ai_overview_search(query, codes)
    except DataForSeoError as error:
        logger.warning('Google AI Overviews failed: %s %s', error.code, error.provider_status)
        result = _aio_error(error, query, start_time, error_code=error.code)
        if error.cost_usd:
            result["metadata"]["cost_usd"] = error.cost_usd
        return result
    except Exception as error:
        logger.exception('Google AI Overviews error')
        return _aio_error(error, query, start_time)
    logger.info(
        "Google AI Overviews: %s with %s citations for '%s'", overview.status, len(overview.citations), query,
    )
    return aio_result(overview, query)
