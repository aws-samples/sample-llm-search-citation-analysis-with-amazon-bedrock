"""Keyword research and keyword metrics over DataForSEO, routed by ``MarketCodes.keyword_data``:

- Labs countries, ``auto`` mode: ``keyword_suggestions`` and ``keyword_ideas`` at
  ``ceil(limit / 2)`` each, in parallel; both always finish before a failure is raised, then they are
  interleaved and deduped to ``limit``. Fewer than
  ``MIN_NON_SEED_FOR_AUTO`` non-seed rows → ``related_keywords`` (depth 3, full ``limit``) is
  interleaved in. Manual modes call one endpoint at the full limit. ``ignore_synonyms`` is
  ``not group_keywords``.
- Google Ads countries: ``keywords_for_keywords`` (mode, clickstream and grouping are ignored).
- Metrics for a known list (national): Labs ``keyword_overview`` or
  Ads ``search_volume``, in batches of ``KEYWORD_METRICS_BATCH_SIZE``.

Only the seed is researched. Labs/Ads keywords are sent as normalized text, unescaped; ``%``/``+`` are
escaped only on SERP calls.

Every requested keyword gets a metric row, in request order (nulls when the provider has none), on Labs
too, so a refresh clears stale numbers instead of keeping those of keywords the provider omitted.
Requested duplicates (after normalization) and empty keywords are dropped.

Under a ``call_deadline`` with less than ``MIN_FALLBACK_DEADLINE_S`` left after the blend, the
``related`` fallback is skipped and the blend returned (``used_fallback=False``), so a slow blend never pushes
a third billed call past the API Gateway limit.

When a parallel or fallback call fails after a sibling call was billed, the raised
``DataForSeoError.cost_usd`` includes the sibling's cost, so the caller records every completed
charge before the failure is raised.
"""

from __future__ import annotations

import contextvars
import logging
import math
from collections.abc import Callable, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass

from shared.dataforseo_client import DataForSeoError, remaining_deadline_s
from shared.dataforseo_google_ads import fetch_ads_research_rows, fetch_search_volume_metrics
from shared.dataforseo_keyword_rows import (
    KeywordMetric,
    KeywordRow,
    KeywordSourceName,
    MonthlySearch,
    normalize_keyword,
    null_metric,
)
from shared.dataforseo_labs import LabsSource, fetch_overview_metrics, fetch_research_rows
from shared.dataforseo_locations import MarketCodes

__all__ = [
    'KEYWORD_METRICS_BATCH_SIZE',
    'MIN_NON_SEED_FOR_AUTO',
    'RESEARCH_MODES',
    'KeywordMetric',
    'KeywordRow',
    'MonthlySearch',
    'ResearchResult',
    'interleave_rows',
    'keyword_metrics',
    'research_keywords',
]

logger = logging.getLogger(__name__)

#: An auto blend with fewer non-seed rows than this also reads related keywords.
MIN_NON_SEED_FOR_AUTO = 5
#: The ``related`` fallback runs only with at least this much ``call_deadline`` left (a Labs call can take seconds).
MIN_FALLBACK_DEADLINE_S = 8.0
#: DataForSEO's batch metric endpoints accept up to ~700 keywords per call.
KEYWORD_METRICS_BATCH_SIZE = 700
RESEARCH_MODES = ('auto', 'related', 'suggestions', 'ideas')
_MANUAL_SOURCES: dict[str, LabsSource] = {'related': 'related', 'suggestions': 'suggestions', 'ideas': 'ideas'}

_RowsFetch = tuple[list[KeywordRow], float]


@dataclass(frozen=True)
class ResearchResult:
    """Keyword ideas for one seed."""

    rows: tuple[KeywordRow, ...]
    source: str
    used_fallback: bool
    cost_usd: float


def interleave_rows(first: Sequence[KeywordRow], second: Sequence[KeywordRow], limit: int) -> list[KeywordRow]:
    """Alternate the i-th rows of both sources, dedupe by keyword, stop at ``limit``."""
    rows: list[KeywordRow] = []
    seen: set[str] = set()
    for index in range(max(len(first), len(second))):
        for source in (first, second):
            if len(rows) >= limit:
                return rows
            if index < len(source) and source[index].keyword not in seen:
                seen.add(source[index].keyword)
                rows.append(source[index])
    return rows


def _count_non_seed(rows: Sequence[KeywordRow], seed: str) -> int:
    return sum(1 for row in rows if row.keyword != seed)


def _charged(error: DataForSeoError, spent_usd: float) -> DataForSeoError:
    """``error`` carrying the cost of sibling calls that were already billed."""
    if spent_usd:
        error.cost_usd = (error.cost_usd or 0.0) + spent_usd
    return error


def _settled(future: Future[_RowsFetch]) -> _RowsFetch | DataForSeoError:
    """The future's value, or its ``DataForSeoError`` (anything else propagates)."""
    error = future.exception()
    if error is None:
        return future.result()
    if isinstance(error, DataForSeoError):
        return error
    raise error


def _fetch_blend_halves(fetch: Callable[[LabsSource, int], _RowsFetch], half: int) -> tuple[_RowsFetch, _RowsFetch]:
    """Suggestions and ideas in parallel; a failure is raised only after both calls have finished."""
    with ThreadPoolExecutor(max_workers=2) as pool:
        # Each worker runs in a copy of this context, so the caller's `call_deadline` applies to it.
        suggestions_future = pool.submit(contextvars.copy_context().run, fetch, 'suggestions', half)
        ideas_future = pool.submit(contextvars.copy_context().run, fetch, 'ideas', half)
    suggestions = _settled(suggestions_future)
    ideas = _settled(ideas_future)
    if isinstance(suggestions, DataForSeoError):
        if isinstance(ideas, DataForSeoError):
            logger.warning('dataforseo.research.ideas-leg failed: %s', ideas.code)
            raise _charged(suggestions, ideas.cost_usd or 0.0)
        raise _charged(suggestions, ideas[1])
    if isinstance(ideas, DataForSeoError):
        raise _charged(ideas, suggestions[1])
    return suggestions, ideas


def _fallback_fits_deadline() -> bool:
    """Whether the ``related`` fallback may start: no deadline, or at least ``MIN_FALLBACK_DEADLINE_S`` left."""
    remaining = remaining_deadline_s()
    if remaining is None or remaining >= MIN_FALLBACK_DEADLINE_S:
        return True
    logger.warning('dataforseo.research.fallback-skipped remaining_s=%.1f', remaining)
    return False


def _auto_rows(seed: str, limit: int, fetch: Callable[[LabsSource, int], _RowsFetch]) -> ResearchResult:
    (suggestions, suggestions_cost), (ideas, ideas_cost) = _fetch_blend_halves(fetch, math.ceil(limit / 2))
    blended = interleave_rows(suggestions, ideas, limit)
    spent = suggestions_cost + ideas_cost
    if _count_non_seed(blended, seed) >= MIN_NON_SEED_FOR_AUTO or not _fallback_fits_deadline():
        return ResearchResult(rows=tuple(blended), source='blended', used_fallback=False, cost_usd=spent)
    try:
        related, related_cost = fetch('related', limit)
    except DataForSeoError as error:
        _charged(error, spent)
        raise
    return ResearchResult(
        rows=tuple(interleave_rows(blended, related, limit)),
        source='blended',
        used_fallback=True,
        cost_usd=spent + related_cost,
    )


def research_keywords(seed: str, codes: MarketCodes, *, mode: str = 'auto', limit: int = 150,
                      group_keywords: bool = False, clickstream: bool = False) -> ResearchResult:
    """Keyword ideas for ``seed`` in one market (see the module docstring for the routing)."""
    seed_keyword = normalize_keyword(seed)
    if not seed_keyword:
        raise ValueError('seed keyword is empty')
    if mode not in RESEARCH_MODES:
        raise ValueError(f'unknown research mode {mode!r}')
    if codes.keyword_data == 'google_ads':
        rows, cost = fetch_ads_research_rows(seed_keyword, codes, limit=limit)
        return ResearchResult(rows=tuple(rows), source='google_ads', used_fallback=False, cost_usd=cost)

    def fetch(source: LabsSource, source_limit: int) -> _RowsFetch:
        return fetch_research_rows(
            source, seed_keyword, codes,
            limit=source_limit, ignore_synonyms=not group_keywords, clickstream=clickstream,
        )

    if mode == 'auto':
        return _auto_rows(seed_keyword, limit, fetch)
    manual = _MANUAL_SOURCES[mode]
    rows, cost = fetch(manual, limit)
    return ResearchResult(rows=tuple(rows), source=manual, used_fallback=False, cost_usd=cost)


def _requested(keywords: Sequence[str]) -> list[str]:
    """Normalized, non-empty, first-seen-order keywords."""
    return list(dict.fromkeys(keyword for keyword in map(normalize_keyword, keywords) if keyword))


def keyword_metrics(keywords: Sequence[str], codes: MarketCodes) -> tuple[list[KeywordMetric], float]:
    """National metrics for a known list → (one row per requested keyword in order, billed USD)."""
    source: KeywordSourceName = codes.keyword_data
    fetch_batch = fetch_search_volume_metrics if source == 'google_ads' else fetch_overview_metrics
    requested = _requested(keywords)
    rows: list[KeywordMetric] = []
    cost = 0.0
    for start in range(0, len(requested), KEYWORD_METRICS_BATCH_SIZE):
        batch = requested[start:start + KEYWORD_METRICS_BATCH_SIZE]
        try:
            found, batch_cost = fetch_batch(batch, codes)
        except DataForSeoError as error:
            _charged(error, cost)
            raise
        cost += batch_cost
        rows.extend(found.get(keyword) or null_metric(keyword, source) for keyword in batch)
    return rows, cost
