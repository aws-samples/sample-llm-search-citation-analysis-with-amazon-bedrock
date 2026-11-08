"""
Get Brand Mentions API

Brand mentions of one analysis run for a keyword or a report scope, as a
bounded summary (``view=summary``, the default), as pages of every brand
(``view=brands``: the summary lists the first ``BRAND_LIMIT`` with
``aggregated.brands_total`` / ``aggregated.brands_next_token``, 2.45.0 wave 5)
or as pages of every appearance (``view=appearances``). Brands are classified first_party,
competitor or other by the extraction step. Files of every appearance come
from the export service (``POST /api/exports``, view ``brand-appearances``;
the ``export=`` job of 2.44 is gone, 2.45.0 wave 5).

Where a scope is answered from (``shared.brand_mention_views.latest_run_source``):

- **live** (one keyword, ``keyword_ids``, and scopes within
  ``scope_source.LIVE_ROWS_BUDGET``): every keyword of the scope, read in
  parallel within the request's time budget. Keywords the budget leaves
  unread are left out (``keywords_truncated``, ``coverage``); ``truncated``
  is true whenever the budget cut anything.
- **snapshot** (larger scopes, each keyword's latest run): the scope's build
  (``shared.artifact_mentions``), complete as of ``as_of``; the summary reads
  the rows its brand previews name (at most 500, BatchGet) and an
  appearances page reads only the keywords it covers. Another run
  (``timestamp``) or a scope without a build answers 202 from a view job.

Appearance pages are keyword-major (the scope's keywords in order; within a
keyword by the brand's ``overall_rank``, then as read) with a keyword cursor
(``next_token`` ``{k, r, f}``); ``total_appearances`` is exact. A cursor of
another list (the scope, its runs or the build changed) answers 400
``cursor_expired``. Every scoped body carries ``coverage``, ``source``,
``as_of``, ``stale`` and ``refreshing`` (``shared.snapshot_artifacts``).
"""

import logging
import sys
from dataclasses import dataclass
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.answer_queries import latest_run_timestamp
from shared.api_response import not_found_response, success_response, validation_error
from shared.artifact_mentions import MentionReaders, appearances_fingerprint
from shared.brand_mention_views import (
    KEYWORD_APPEARANCE_LIMIT,
    KEYWORD_ATTRIBUTE_NAMES,
    KEYWORD_PROJECTION,
    RUN_LISTING_DEEP_KEYWORDS,
    RUN_LISTING_LIMIT,
    appearance_page,
    brand_list_page,
    brand_summary,
    brands_page_block,
    collect_brands,
    filter_rows,
    keyword_appearances,
    latest_run_source,
    list_runs,
    provider_entry,
    rank_map,
    read_run_rows,
    with_brands_cursor,
)
from shared.cursors import CURSOR_ERROR_MESSAGE, CURSOR_QUERY_PARAM
from shared.decorators import api_handler, optional_limit, optional_provider, validate
from shared.keyword_major_pages import list_fingerprint
from shared.kpi_scope_serve import LIVE_BUILD_ID
from shared.mention_row_reads import preview_rows
from shared.mention_scope_answers import LargeScopeView, live_lists_page, live_scope_contract, serve_large_scope
from shared.mention_view_jobs import ROUTE_APPEARANCES, ROUTE_SUMMARY
from shared.request_deadline import current_deadline
from shared.scope_params import SCOPE_QUERY_PARAMS, ReportScope, keywords_table_name
from shared.scoped_reports import ScopeRead, read_scope_keywords, required_report_scope
from shared.search_results import search_results_table_name
from shared.snapshot_artifacts import (
    SOURCE_SNAPSHOT,
    coverage,
    cursor_expired_response,
    decode_snapshot_cursor,
    live_envelope,
    with_scope_contract,
)
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Scopes resolve against the Keywords table; every row a report reads comes from SearchResults.
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()

VIEWS = ('summary', 'brands', 'appearances')
MENTIONS_BUILDER = 'mentions'


@dataclass(frozen=True)
class _RowFilters:
    """The run and row filters one request applies to every keyword it reads."""

    timestamp: str | None
    query_prompt_id: str | None
    provider: str | None

    def params(self) -> dict[str, Any]:
        return {'timestamp': self.timestamp, 'query_prompt_id': self.query_prompt_id, 'provider': self.provider}


@dataclass(frozen=True)
class _Appearances:
    """What one appearances page asks for."""

    classification: str | None
    brand: str | None
    limit: int
    next_token: str | None

    def params(self) -> dict[str, Any]:
        return {'classification': self.classification, 'brand': self.brand, 'limit': self.limit, 'next_token': self.next_token}


@dataclass(frozen=True)
class _BrandPage:
    """Where a ``view=brands`` page starts: an offset in the ranked brand list and the build its token names (``None``: the first page)."""

    offset: int = 0
    build_id: str | None = None

    def is_live(self) -> bool:
        return self.build_id in (None, LIVE_BUILD_ID)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

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


KeywordRun = tuple[list[dict[str, Any]], list[str]]
"""One keyword's rows of the selected run and its newest runs (``_keyword_run``)."""


def _load_scope(keywords: list[str], filters: _RowFilters, *, with_runs: bool) -> ScopeRead[KeywordRun]:
    """``_keyword_run`` for every keyword of the scope, in scope order.

    With ``with_runs`` the first ``RUN_LISTING_DEEP_KEYWORDS`` keywords list
    up to ``RUN_LISTING_LIMIT`` runs each and the others their latest run.
    Keywords the request's time budget leaves unread are ``skipped``.
    """
    deep = set(keywords[:RUN_LISTING_DEEP_KEYWORDS]) if with_runs else set()

    def read(keyword: str) -> KeywordRun:
        depth = 0
        if with_runs:
            depth = RUN_LISTING_LIMIT if keyword in deep else 1
        return _keyword_run(keyword, filters, depth)

    return read_scope_keywords(keywords, read, lambda _keyword: ([], []))


def _snapshot_run_rows(keyword: str, timestamp: str) -> list[dict[str, Any]]:
    """One keyword's rows of the run a build counted (no answer text)."""
    return read_run_rows(dynamodb.Table(SEARCH_RESULTS_TABLE), keyword, timestamp)[1]


def _preview_rows(keys: list[tuple[str, str]]) -> dict[tuple[str, str], dict[str, Any]]:
    """The rows the summary's brand previews name (``shared.mention_row_reads.preview_rows``)."""
    return preview_rows(dynamodb, SEARCH_RESULTS_TABLE, keys)


READERS = MentionReaders(run_rows=_snapshot_run_rows, preview_rows=_preview_rows)


# ---------------------------------------------------------------------------
# Live
# ---------------------------------------------------------------------------

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
    """The summary of every keyword's selected run in a multi-keyword scope, read live.

    With no explicit timestamp each keyword contributes its latest run; with
    one, only rows of that shared run count, so keywords absent from it have
    no data. Engine answers (``by_provider``) are not part of a scope answer.
    """
    loaded = _load_scope(list(scope.keywords), filters, with_runs=True)
    rows = [row for keyword_rows, _runs in loaded.values.values() for row in keyword_rows]
    return live_scope_contract({
        'scope': scope.describe(),
        'keyword': None,
        'timestamp': _rows_timestamp(rows, filters.timestamp),
        'available_runs': _newest({run for _rows, runs in loaded.values.values() for run in runs}),
        'keywords_analyzed': len(loaded.values),
        'keywords_with_data': sum(1 for keyword_rows, _runs in loaded.values.values() if keyword_rows),
        'config': brand_config,
        'by_provider': [],
        'aggregated': with_brands_cursor(brand_summary(rows, classification), LIVE_BUILD_ID),
    }, scope, loaded)


def get_scope_brand_page(scope: ReportScope, filters: _RowFilters, classification: str | None, page: _BrandPage) -> dict[str, Any]:
    """One ``view=brands`` page of a multi-keyword scope read live (the brands in summary order from ``page.offset``)."""
    loaded = _load_scope(list(scope.keywords), filters, with_runs=False)
    rows = [row for keyword_rows, _runs in loaded.values.values() for row in keyword_rows]
    brands, total = brand_list_page(rows, classification, page.offset)
    return live_scope_contract({
        'scope': scope.describe(),
        'keyword': None,
        'timestamp': _rows_timestamp(rows, filters.timestamp),
        'aggregated': brands_page_block(brands, total, page.offset, LIVE_BUILD_ID),
    }, scope, loaded)


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
    available_runs = list_runs(table, keyword, latest)
    body = {
        'keyword': keyword,
        'timestamp': selected,
        'available_runs': available_runs,
        'truncated': current_deadline().cut,
        'config': brand_config,
        'by_provider': [provider_entry(row) for row in rows],
        'aggregated': with_brands_cursor(brand_summary(rows, classification, KEYWORD_APPEARANCE_LIMIT), LIVE_BUILD_ID),
    }
    return with_scope_contract(body, coverage(1, 1), live_envelope())


def get_keyword_brand_page(keyword: str, filters: _RowFilters, classification: str | None, page: _BrandPage) -> dict[str, Any] | None:
    """One ``view=brands`` page of one keyword's selected run; ``None`` when there is no such run."""
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    latest = latest_run_timestamp(table, keyword)
    if latest is None:
        return None
    selected, rows = read_run_rows(table, keyword, filters.timestamp or latest)
    if not rows:
        return None
    brands, total = brand_list_page(filter_rows(rows, filters.query_prompt_id, filters.provider), classification, page.offset, KEYWORD_APPEARANCE_LIMIT)
    body = {
        'keyword': keyword,
        'timestamp': selected,
        'truncated': current_deadline().cut,
        'aggregated': brands_page_block(brands, total, page.offset, LIVE_BUILD_ID),
    }
    return with_scope_contract(body, coverage(1, 1), live_envelope())


def get_appearance_page(
    scope: ReportScope, filters: _RowFilters, page: _Appearances, event: dict[str, Any],
) -> dict[str, Any]:
    """One keyword-major page of every appearance in the scope's selected runs, read live (the 400 of a bad cursor)."""
    loaded = _load_scope(list(scope.keywords), filters, with_runs=False)
    keyword_rows = [rows for rows, _runs in loaded.values.values()]
    all_rows = [row for rows in keyword_rows for row in rows]
    ranks = rank_map(collect_brands(all_rows))
    lists = [keyword_appearances(rows, ranks, page.classification, page.brand) for rows in keyword_rows]
    fingerprint = list_fingerprint(
        'live-appearances', [(keyword, _rows_timestamp(rows, None)) for keyword, (rows, _runs) in loaded.values.items()],
        filters.params(), page.classification, page.brand.strip().lower() if page.brand else None,
    )
    request, rejected = live_lists_page(lists, page.next_token, fingerprint, page.limit, event)
    if request is None:
        return rejected or cursor_expired_response(event)
    appearances, token = appearance_page(request)
    body = {
        'scope': scope.describe(),
        'keyword': scope.keywords[0] if scope.is_single_keyword else None,
        'timestamp': _rows_timestamp(all_rows, filters.timestamp),
        'brand': page.brand,
        'appearances': appearances,
        'total_appearances': sum(len(items) for items in lists),
        'next_token': token,
    }
    if scope.is_single_keyword:
        body.pop('scope')
    return success_response(live_scope_contract(body, scope, loaded), event)


# ---------------------------------------------------------------------------
# Snapshot and view jobs
# ---------------------------------------------------------------------------

def _snapshot_answer(scope: ReportScope, brand_config: dict[str, Any], params: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    """A large scope's summary or appearances page from its build; a view job when the build does not hold it."""
    if params['view'] == 'appearances':
        view = LargeScopeView(
            ROUTE_APPEARANCES, MENTIONS_BUILDER, params, READERS, fingerprint=lambda build_id: appearances_fingerprint(build_id, params),
        )
    elif params['view'] == 'brands':
        view = LargeScopeView(ROUTE_SUMMARY, MENTIONS_BUILDER, params, READERS)
    else:
        view = LargeScopeView(ROUTE_SUMMARY, MENTIONS_BUILDER, params, READERS, extra={'config': brand_config})
    return serve_large_scope(scope, brand_config.get('updated_at'), view, event)


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------

def _brand_page_params(filters: _RowFilters, classification: str | None, brand_page: _BrandPage) -> dict[str, Any]:
    """The params of a large scope's ``view=brands`` page (its view job's key: no keyword cursor)."""
    return {
        **filters.params(), 'view': 'brands', 'classification': classification,
        'offset': brand_page.offset, 'cursor_build': brand_page.build_id, 'next_token': None,
    }


def _scope_answer(
    scope: ReportScope, filters: _RowFilters, view: str, classification: str | None, page: _Appearances, event: dict[str, Any],
    brand_page: _BrandPage,
) -> dict[str, Any]:
    """A multi-keyword scope's answer: live within the budget, else from its snapshot or a view job."""
    if latest_run_source(dynamodb.Table(SEARCH_RESULTS_TABLE), scope.kind, scope.keywords) == SOURCE_SNAPSHOT:
        if view == 'brands':
            return _snapshot_answer(scope, get_brand_config(), _brand_page_params(filters, classification, brand_page), event)
        params = {**filters.params(), **page.params(), 'view': view, 'classification': classification}
        return _snapshot_answer(scope, get_brand_config(), params, event)
    if view == 'brands':
        if not brand_page.is_live():
            return cursor_expired_response(event)
        return success_response(get_scope_brand_page(scope, filters, classification, brand_page), event)
    if view == 'appearances':
        return get_appearance_page(scope, filters, page, event)
    return success_response(get_scope_brand_mentions(scope, get_brand_config(), filters, classification), event)


def _keyword_brand_page(keyword: str, filters: _RowFilters, classification: str | None, brand_page: _BrandPage, event: dict[str, Any]) -> dict[str, Any]:
    if not brand_page.is_live():
        return cursor_expired_response(event)
    result = get_keyword_brand_page(keyword, filters, classification, brand_page)
    if result is None:
        return not_found_response('Results for keyword', event)
    return success_response(result, event)


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
        - view: ``summary`` (default), ``brands`` or ``appearances``
        - next_token: with ``view=brands``, the summary's
          ``aggregated.brands_next_token`` or a page's ``aggregated.next_token``
        - brand, limit, next_token: the ``appearances`` page (one brand when
          ``brand`` is given; ``limit`` rows at most, 500 by default)

    ``summary``: ``{keyword, timestamp, available_runs, truncated, config, by_provider,
    aggregated: {brands, total_unique_brands, matching_brands,
    brands_truncated, summary}}`` (+ ``scope``, ``keywords_truncated``, ``keywords_analyzed``,
    ``keywords_with_data`` for a scope). ``appearances``: ``{keyword,
    timestamp, brand, appearances, total_appearances, next_token,
    keywords_truncated, truncated}`` (+ ``scope`` for a scope). ``brands``:
    ``{keyword, timestamp, aggregated: {brands, brands_total, next_token}}``
    (+ ``scope``, ``keywords_truncated`` for a scope). All add
    ``coverage``, ``source``, ``as_of``, ``stale``, ``refreshing``.
    """
    filters = _RowFilters(timestamp, query_prompt_id, provider)
    page = _Appearances(classification, brand, limit, next_token)
    brand_page = _BrandPage()
    if view == 'brands' and next_token is not None:
        cursor = decode_snapshot_cursor(next_token)
        if cursor is None:
            return validation_error(CURSOR_ERROR_MESSAGE, event, field='next_token')
        brand_page = _BrandPage(cursor.offset, cursor.build_id)
    if not report_scope.is_single_keyword:
        return _scope_answer(report_scope, filters, view, classification, page, event, brand_page)
    if view == 'brands':
        return _keyword_brand_page(report_scope.keywords[0], filters, classification, brand_page, event)
    if view == 'appearances':
        return get_appearance_page(report_scope, filters, page, event)
    result = get_keyword_brand_mentions(report_scope.keywords[0], get_brand_config(), filters, classification)
    if result is None:
        return not_found_response('Results for keyword', event)
    return success_response(result, event)
