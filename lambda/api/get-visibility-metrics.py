"""
Visibility Metrics API — GET /api/visibility

Where the brand stands now in a scope (exactly one of ``keyword=``,
``group_id=``, ``keyword_ids=`` or ``scope=all``): every KPI of
``docs/kpi-definitions.md`` over each keyword's latest analysis run, pooled,
its change since each keyword's previous run (like for like), the brand
leaderboard of those answers, and a row per keyword. One response shape for
every scope; formulas in ``shared.kpi_engine``.

Optional: ``query_prompt_id`` keeps one persona's answers of the latest run;
``branded`` keeps the answers to queries that do not name the brand
(``neutral``), that do (``branded``), or every answer (``all``, the default);
``brand`` narrows the leaderboard to matching brand names.

Complete for every scope (2.45.0): a scope whose two newest runs fit the live
budget (``shared.kpi_scope_serve.kpi_route``) is read whole for the request,
every keyword of it; a larger one is served from its scope snapshot
(``shared.artifact_latest``), or answers 202 while a view job computes it.
Keyword rows: every row live; from a snapshot the first ``KEYWORDS_PAGE`` in
``keywords`` and the rest through ``keywords_next_token`` (``view=keywords``
with ``next_token`` answers the next page). Every body carries ``coverage``,
``source``, ``as_of``, ``stale`` and ``refreshing``. The time budget stays a
safety net on the live path: keywords it left unread are left out and
``keywords_truncated`` (and ``coverage.complete`` false) say so.

Full lists (2.45.0): ``brands`` and ``sources`` are the first page of the
whole leaderboard and source table; ``brands_next_token`` /
``sources_next_token`` page the rest through ``view=brands`` /
``view=sources`` (100 rows a page; without a token the page from the top).
A live scope's tokens name the ``live`` build, so they are good only while
the scope is served live.
"""

import logging
import sys
from dataclasses import asdict, replace
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.answer_queries import query_last_two_runs_rows
from shared.api_response import success_response
from shared.artifact_latest import LIST_VIEWS, LatestParams, live_latest_artifacts, serve_latest, variant_of
from shared.artifact_latest import NAME as LATEST_BUILDER
from shared.brand_visibility import tracked_brand_names
from shared.decorators import api_handler, validate
from shared.kpi_engine import BRANDED_FILTERS, owned_domains_from
from shared.kpi_scope_serve import (
    Served,
    SnapshotRequest,
    kpi_route,
    live_artifacts,
    live_keyword_latest,
    live_list_offset,
    live_page_rejection,
    scoped_body,
    serve_from_snapshot,
    view_query_params,
)
from shared.partial_contract import PartialConfig
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    keywords_table_name,
    scoped_dynamodb_resource,
)
from shared.scoped_reports import read_scope_keywords, required_report_scope
from shared.search_results import search_results_table_name
from shared.snapshot_artifacts import SOURCE_LIVE
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: The route's name for view jobs.
ROUTE = 'visibility'

VIEWS = ('summary', 'keywords', *LIST_VIEWS)

#: The params that pick only the list or page served: one view job's artifacts answer every one of them.
_PAGE_PARAMS = ('view', 'page_size', 'offset')

# One latest-run read per keyword, SCOPE_MAX_WORKERS at a time (map_scope_keywords).
dynamodb = scoped_dynamodb_resource()

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()


def live_visibility(scope: ReportScope, brand_config: dict[str, Any], params: LatestParams) -> tuple[dict[str, Any], int, bool]:
    """The visibility body (or ``params.view`` page) of ``scope`` read for this request, the keywords it covers, and whether the time budget cut it.

    Every keyword's two newest runs are read in parallel and pooled through
    the ``kpi`` partials, as the snapshot builder pools them. A keyword
    whose read fails has no data (logged by ``map_scope_keywords``); one the
    time budget left unread is left out. Keyword rows come whole; a brand or
    source page starts at ``params.offset``.
    """
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    config = PartialConfig(brand_config=brand_config)
    read = read_scope_keywords(
        list(scope.keywords),
        lambda keyword: live_keyword_latest(keyword, *query_last_two_runs_rows(table, keyword), config),
        lambda keyword: live_keyword_latest(keyword, [], [], config),
    )
    artifacts = live_artifacts(live_latest_artifacts(read.values.values(), variant_of(params.persona, params.branded)), len(read.values))
    offset = params.offset if params.view in LIST_VIEWS else 0
    body = serve_latest(artifacts, replace(params, offset=offset, page_size=None))
    return body or {}, len(read.values), bool(read.skipped)


def _scope_fields(scope: ReportScope, truncated: bool, owned_domains: list[str], branded: str) -> dict[str, Any]:
    return {
        'scope': scope.describe(), 'keywords_truncated': truncated, 'branded': branded,
        'citations_configured': bool(owned_domains),
    }


def _keywords_page(scope: ReportScope, body: dict[str, Any]) -> dict[str, Any]:
    return {'scope': scope.describe(), 'keywords': body['keywords'], 'keywords_total': body['keywords_total'], 'next_token': body.get('next_token')}


def _live_answer(event: dict[str, Any], report_scope: ReportScope, config: dict[str, Any], params: LatestParams, next_token: str | None) -> dict[str, Any]:
    """The answer of a scope read live: the summary, every keyword row, or a brand / source page (live tokens only)."""
    offset = live_list_offset(next_token, event) if params.view in LIST_VIEWS else live_page_rejection(next_token, event) or 0
    if isinstance(offset, dict):
        return offset
    body, analyzed, truncated = live_visibility(report_scope, config, replace(params, offset=offset))
    if params.view in LIST_VIEWS:
        page = {'scope': report_scope.describe(), **body, 'keywords_truncated': truncated}
        return success_response(scoped_body(page, report_scope, analyzed), event)
    if params.view == 'keywords':
        return success_response(scoped_body({**_keywords_page(report_scope, body), 'next_token': None}, report_scope, analyzed), event)
    owned_domains = owned_domains_from(config)
    return success_response(scoped_body({**_scope_fields(report_scope, truncated, owned_domains, params.branded), **body}, report_scope, analyzed), event)


@api_handler
@validate({
    'branded': {'type': str, 'choices': list(BRANDED_FILTERS), 'default': 'all'},
    **SCOPE_QUERY_PARAMS,
    'brand': {'type': str, 'max_length': 200},
    'query_prompt_id': {'type': str, 'max_length': 100},
    **view_query_params(VIEWS),
})
@required_report_scope(lambda: dynamodb.Table(KEYWORDS_TABLE))
def handler(event, context, report_scope, brand=None, query_prompt_id=None, branded='all', view='summary', next_token=None):
    """GET /api/visibility — the KPIs of a scope's latest runs (see the module docstring).

    ``branded`` (``neutral`` | ``branded`` | ``all``, default ``all``) keeps the
    answers to queries that do not name the brand, that do, or every answer.
    """
    config = get_brand_config()
    first_party, competitors = tracked_brand_names(config)
    owned_domains = owned_domains_from(config)
    params = LatestParams(
        persona=query_prompt_id, branded=branded, brand=brand, tracked_brands=(*first_party, *competitors), view=view,
        citations_configured=bool(owned_domains),
    )
    if kpi_route(report_scope, dynamodb) == SOURCE_LIVE:
        return _live_answer(event, report_scope, config, params, next_token)
    served = serve_from_snapshot(SnapshotRequest(
        route=ROUTE, builder=LATEST_BUILDER, params=asdict(params), report_scope=report_scope,
        brand_config_updated_at=config.get('updated_at'), event=event, next_token=next_token,
        job_params={name: value for name, value in asdict(params).items() if name not in _PAGE_PARAMS},
    ))
    if not isinstance(served, Served):
        return served
    if view in LIST_VIEWS:
        page = {'scope': report_scope.describe(), **served.body, 'keywords_truncated': False}
        return success_response(scoped_body(page, report_scope, len(report_scope.keywords), served.artifacts), event)
    if view == 'keywords':
        page = _keywords_page(report_scope, served.body)
        return success_response(scoped_body(page, report_scope, len(report_scope.keywords), served.artifacts), event)
    body = {**_scope_fields(report_scope, False, owned_domains, branded), **served.body}
    return success_response(scoped_body(body, report_scope, len(report_scope.keywords), served.artifacts), event)
