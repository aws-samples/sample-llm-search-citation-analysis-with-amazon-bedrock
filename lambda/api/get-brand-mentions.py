"""
Get Brand Mentions API

Brand mentions of one analysis run for a keyword or a report scope, as a
bounded summary (``view=summary``, the default) or as pages of every
appearance (``view=appearances``). Brands are classified first_party,
competitor or other by the extraction step.

Both views read only the selected run of each keyword partition (the sort key
starts with the run timestamp), never the keyword's whole history; the size
rules live in ``shared.brand_mention_views``.
"""

import logging
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.answer_queries import latest_run_timestamp
from shared.api_response import not_found_response, success_response, validation_error
from shared.brand_mention_views import (
    KEYWORD_APPEARANCE_LIMIT,
    KEYWORD_ATTRIBUTE_NAMES,
    KEYWORD_PROJECTION,
    RUN_LISTING_DEEP_KEYWORDS,
    RUN_LISTING_LIMIT,
    appearance_rows,
    brand_summary,
    filter_rows,
    list_runs,
    provider_entry,
    read_run_rows,
)
from shared.cursors import CURSOR_ERROR_MESSAGE, CURSOR_QUERY_PARAM, decode_offset_cursor, encode_offset_cursor
from shared.decorators import api_handler, optional_limit, optional_provider, validate
from shared.response_budget import take_within_budget
from shared.scope_params import SCOPE_QUERY_PARAMS, ReportScope, keywords_table_name
from shared.scoped_reports import required_report_scope
from shared.search_results import search_results_table_name
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Scopes resolve against the Keywords table; every row a report reads comes from SearchResults.
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()

# Scope reads fan out one keyword per worker.
_SCOPE_MAX_WORKERS = 10

VIEWS = ('summary', 'appearances')


@dataclass(frozen=True)
class _RowFilters:
    """The run and row filters one request applies to every keyword it reads."""

    timestamp: str | None
    query_prompt_id: str | None
    provider: str | None


def _keyword_run(keyword: str, filters: _RowFilters, run_depth: int) -> tuple[list[dict[str, Any]], list[str]]:
    """One keyword's rows of the selected run (projected, no answer text) and its newest ``run_depth`` runs."""
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    runs: list[str] = []
    if run_depth:
        latest = latest_run_timestamp(table, keyword)
        if latest is None:
            return [], []
        runs = list_runs(table, keyword, latest, run_depth)
        selected = filters.timestamp or latest
    else:
        selected = filters.timestamp
    _, rows = read_run_rows(table, keyword, selected)
    return filter_rows(rows, filters.query_prompt_id, filters.provider), runs


def _load_scope(scope: ReportScope, filters: _RowFilters, *, with_runs: bool) -> list[tuple[list[dict[str, Any]], list[str]]]:
    """``_keyword_run`` for every keyword of ``scope``, in scope order.

    With ``with_runs`` the first ``RUN_LISTING_DEEP_KEYWORDS`` keywords list
    up to ``RUN_LISTING_LIMIT`` runs each and the others their latest run.
    """
    keywords = list(scope.keywords)
    if not keywords:
        return []

    def read(position_keyword: tuple[int, str]) -> tuple[list[dict[str, Any]], list[str]]:
        position, keyword = position_keyword
        depth = 0
        if with_runs:
            depth = RUN_LISTING_LIMIT if position < RUN_LISTING_DEEP_KEYWORDS else 1
        return _keyword_run(keyword, filters, depth)

    with ThreadPoolExecutor(max_workers=min(_SCOPE_MAX_WORKERS, len(keywords))) as pool:
        return list(pool.map(read, enumerate(keywords)))


def _newest(runs: set[str]) -> list[str]:
    return sorted(runs, reverse=True)[:RUN_LISTING_LIMIT]


def _rows_timestamp(rows: list[dict[str, Any]], timestamp: str | None) -> str | None:
    return timestamp or max((row.get('timestamp', '') for row in rows), default=None)


def get_scope_brand_mentions(
    scope: ReportScope,
    brand_config: dict[str, Any],
    filters: _RowFilters,
    classification: str | None,
) -> dict[str, Any]:
    """The summary of every keyword's selected run in a multi-keyword scope.

    With no explicit timestamp each keyword contributes its latest run; with
    one, only rows of that shared run count, so keywords absent from it have
    no data. Engine answers (``by_provider``) are not part of a scope answer.
    """
    loaded = _load_scope(scope, filters, with_runs=True)
    rows = [row for keyword_rows, _runs in loaded for row in keyword_rows]
    return {
        'scope': scope.describe(),
        'keyword': None,
        'timestamp': _rows_timestamp(rows, filters.timestamp),
        'available_runs': _newest({run for _rows, runs in loaded for run in runs}),
        'keywords_analyzed': len(scope.keywords),
        'keywords_with_data': sum(1 for keyword_rows, _runs in loaded if keyword_rows),
        'config': brand_config,
        'by_provider': [],
        'aggregated': brand_summary(rows, classification),
    }


def get_keyword_brand_mentions(
    keyword: str,
    brand_config: dict[str, Any],
    filters: _RowFilters,
    classification: str | None,
) -> dict[str, Any] | None:
    """The summary of one keyword's selected run with each engine's answer; ``None`` when there is no such run."""
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    latest = latest_run_timestamp(table, keyword)
    if latest is None:
        return None
    selected, rows = read_run_rows(
        table, keyword, filters.timestamp or latest,
        projection=KEYWORD_PROJECTION, attribute_names=KEYWORD_ATTRIBUTE_NAMES,
    )
    if not rows:
        return None
    rows = filter_rows(rows, filters.query_prompt_id, filters.provider)
    return {
        'keyword': keyword,
        'timestamp': selected,
        'available_runs': list_runs(table, keyword, latest),
        'config': brand_config,
        'by_provider': [provider_entry(row) for row in rows],
        'aggregated': brand_summary(rows, classification, KEYWORD_APPEARANCE_LIMIT),
    }


def get_appearance_page(
    scope: ReportScope,
    filters: _RowFilters,
    classification: str | None,
    brand: str | None,
    page: tuple[int, int],
) -> dict[str, Any]:
    """One page of every appearance in the scope's selected runs (``page`` = offset, limit)."""
    offset, limit = page
    rows = [row for keyword_rows, _runs in _load_scope(scope, filters, with_runs=False) for row in keyword_rows]
    appearances = appearance_rows(rows, classification, brand)
    taken, _more = take_within_budget(appearances[offset:], max_items=limit)
    return {
        **({} if scope.is_single_keyword else {'scope': scope.describe()}),
        'keyword': scope.keywords[0] if scope.is_single_keyword else None,
        'timestamp': _rows_timestamp(rows, filters.timestamp),
        'brand': brand,
        'appearances': taken,
        'total_appearances': len(appearances),
        'next_token': encode_offset_cursor(offset + len(taken), len(appearances)),
    }


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    **CURSOR_QUERY_PARAM,
    'timestamp': {'type': str, 'max_length': 50},
    'provider': optional_provider(),
    'classification': {'type': str, 'choices': ['first_party', 'competitor', 'other']},
    'query_prompt_id': {'type': str, 'max_length': 100},
    'view': {'type': str, 'choices': list(VIEWS), 'default': 'summary'},
    'brand': {'type': str, 'max_length': 200},
    'limit': optional_limit(default=500, max_val=2000),
})
@required_report_scope(lambda: dynamodb.Table(KEYWORDS_TABLE))
def handler(event: dict[str, Any], context: Any, report_scope: ReportScope, timestamp: str | None = None,
            provider: str | None = None, classification: str | None = None, query_prompt_id: str | None = None,
            view: str = 'summary', brand: str | None = None, limit: int = 500,
            next_token: str | None = None) -> dict[str, Any]:
    """
    GET /api/brand-mentions for a keyword or a report scope.

    Query params (exactly one scope):
        - keyword: one keyword (the summary adds each engine's answer)
        - group_id / keyword_ids / scope=all: aggregate across keywords
        - timestamp: one analysis run (default: each keyword's latest)
        - provider, classification, query_prompt_id: row and brand filters
        - view: ``summary`` (default) or ``appearances``
        - brand, limit, next_token: the ``appearances`` page (one brand when
          ``brand`` is given; ``limit`` rows at most, 500 by default)

    ``summary``: ``{keyword, timestamp, available_runs, config, by_provider,
    aggregated: {brands, total_unique_brands, matching_brands,
    brands_truncated, summary}}`` (+ ``scope``, ``keywords_analyzed``,
    ``keywords_with_data`` for a scope). ``appearances``: ``{keyword,
    timestamp, brand, appearances, total_appearances, next_token}``.
    """
    filters = _RowFilters(timestamp, query_prompt_id, provider)
    if view == 'appearances':
        offset = decode_offset_cursor(next_token)
        if offset is None:
            return validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')
        return success_response(get_appearance_page(report_scope, filters, classification, brand, (offset, limit)), event)

    brand_config = get_brand_config()
    if not report_scope.is_single_keyword:
        return success_response(get_scope_brand_mentions(report_scope, brand_config, filters, classification), event)

    result = get_keyword_brand_mentions(report_scope.keywords[0], brand_config, filters, classification)
    if result is None:
        return not_found_response('Results for keyword', event)
    return success_response(result, event)
