"""
SEO Backlinks API (response shapes in ``web/src/types/api/seoBacklinks.ts``):

- POST /api/seo/backlinks/overview          - overview metrics and a year of history of one target (paid)
- POST /api/seo/backlinks/rows              - one page of links (paid)
- POST /api/seo/backlinks/referring-domains - one page of referring domains (paid)
- POST /api/seo/backlinks/top-pages         - one page of the target's most linked pages (paid)
- GET  /api/seo/backlinks/snapshots         - stored weekly snapshots of the owned and competitor domains (free)
- POST /api/seo/backlinks/snapshots         - Admin: snapshot every tracked domain now (paid, one call per domain)
- PUT  /api/seo/backlinks/snapshots/schedule - Admin: turn the weekly snapshot on or off

The paid lookups are open to every signed-in user (one-off spend); snapshots are batch and recurring spend, so
starting them and scheduling them is Admin only.

Every target is normalized and every filter checked against DataForSEO's 8-condition budget before any paid call
(``shared.backlinks_target``, ``shared.backlinks_filters``): a refused request is a 400 ``VALIDATION_ERROR`` with
the reason, never a truncated query. Answers are cached 6 h (namespaces ``backlinks-overview`` /
``backlinks-table``, v1) under every input that changes the result: the API target, scope, subfolder path,
subdomain flag, page, page size, sort, normalized filters, link mode and spam rule. An empty table page lives
1 h, and an overview whose history call failed 15 minutes, so a retry soon gets the history without paying for the
summary again right away. ``has_more`` comes from DataForSEO's ``total_count`` of every matching row, never from
the size of the page.

The tables also serve the paid Excel export (``seo_export``): ``limit`` (1..1000) and ``offset`` (0..9999,
``offset + limit`` <= 10,000) replace the page, are cached under their own key and priced ``backlinks_usd(limit)``.
Every table answer echoes ``offset``/``limit`` (``null`` on a page) and carries the ``export`` prices.

The history is one ``history/live`` call and exists for the domain and subdomain scopes only: it always includes
subdomains (``history_includes_subdomains``), and an exact page or a subfolder has none.
"""

import functools
import json
import logging
import os
import sys
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

import boto3
from seo_export import EXPORT_SCHEMA, ExportWindowError, export_pricing, row_window
from seo_http import CachePolicy, brand_config, seo_error, seo_route, validation_errors

from shared.api_response import success_response
from shared.auth import ADMIN_GROUP, get_caller_identity, require_group
from shared.backlink_snapshots import domain_history, schedule_enabled, set_schedule, snapshots_table, tracked_domains
from shared.backlinks_filters import (
    TABS,
    FilterError,
    Tab,
    build_filters,
    condition_limit,
    order_by,
    parse_filters,
)
from shared.backlinks_target import MAX_TARGET_CHARS, SCOPES, BacklinksTarget, InvalidTargetError, backlinks_target
from shared.dataforseo_backlinks import (
    BACKLINKS_ROW_USD,
    BACKLINKS_TASK_USD,
    HISTORY_USD,
    MODES,
    SUMMARY_USD,
    Mode,
    TableQuery,
    backlinks_usd,
    fetch_history,
    fetch_summary,
    fetch_table,
    subfolder_totals,
)
from shared.dataforseo_client import DataForSeoError
from shared.decorators import json_object_body, validate
from shared.utils import get_timestamp, get_timestamp_compact

logger = logging.getLogger(__name__)

OVERVIEW_CACHE = CachePolicy(namespace='backlinks-overview', version=1, ttl_seconds=21_600)
TABLE_CACHE = CachePolicy(namespace='backlinks-table', version=1, ttl_seconds=21_600)
EMPTY_TABLE_TTL_SECONDS = 3_600
PARTIAL_OVERVIEW_TTL_SECONDS = 900
STATE_MACHINE_ENV = 'SEO_BACKLINK_SNAPSHOTS_STATE_MACHINE_ARN'

PAGE_SIZES = [50, 100, 200]
MAX_PAGE = 100
SUBFOLDER_DOMAINS_MESSAGE = (
    "Referring domains can't be broken down for a subfolder: use the Backlinks tab, or switch to Domain or "
    'Subdomains scope.'
)

TARGET_SCHEMA: dict[str, dict[str, Any]] = {
    'target': {'required': True, 'type': str, 'min_length': 1, 'max_length': MAX_TARGET_CHARS},
    'scope': {'type': str, 'choices': [*SCOPES, 'page']},
}
TABLE_SCHEMA: dict[str, dict[str, Any]] = {
    **TARGET_SCHEMA,
    'page': {'type': int, 'min': 1, 'max': MAX_PAGE, 'default': 1},
    'page_size': {'type': int, 'choices': PAGE_SIZES, 'default': 50},
    'sort_field': {'type': str, 'max_length': 40},
    'sort_order': {'type': str, 'choices': ['asc', 'desc'], 'default': 'desc'},
    'include_spam': {'type': bool, 'default': False},
    'mode': {'type': str, 'choices': list(MODES), 'default': 'one_per_domain'},
    **EXPORT_SCHEMA,
}
BACKLINKS_EXPORT = export_pricing(BACKLINKS_TASK_USD, BACKLINKS_ROW_USD)
SCHEDULE_SCHEMA: dict[str, dict[str, Any]] = {'enabled': {'required': True, 'type': bool}}

Handler = Callable[..., dict[str, Any]]


#: Answer an unusable target, filter or export window as a 400 ``VALIDATION_ERROR`` before anything is paid.
backlinks_errors = validation_errors({InvalidTargetError: 'target', FilterError: 'filters', ExportWindowError: None})


def target_params(target: BacklinksTarget) -> dict[str, Any]:
    return {
        'target': target.api_target, 'scope': target.scope, 'path': target.path,
        'include_subdomains': target.include_subdomains,
    }


def target_json(target: BacklinksTarget) -> dict[str, Any]:
    return {'target': target.display, 'api_target': target.api_target, 'scope': target.scope}


def has_history(target: BacklinksTarget) -> bool:
    return target.scope in ('domain', 'subdomains')


def utc_today() -> Any:
    return datetime.now(UTC).date()


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

def overview_cost_usd(target: BacklinksTarget) -> float:
    if target.scope == 'subfolder':
        return round(2 * SUMMARY_USD, 6)
    return round(SUMMARY_USD + (HISTORY_USD if has_history(target) else 0.0), 6)


def subfolder_summary(target: BacklinksTarget) -> dict[str, Any]:
    backlinks, referring_domains, _cost = subfolder_totals(target)
    return {'backlinks': backlinks, 'referring_domains': referring_domains}


def fresh_overview(target: BacklinksTarget) -> dict[str, Any]:
    """Call DataForSEO and cache the answer; a failed history keeps the paid summary and is cached briefly."""
    trends: list[dict[str, Any]] = []
    new_lost: list[dict[str, Any]] = []
    history_failed = False
    if target.scope == 'subfolder':
        summary: dict[str, Any] | None = subfolder_summary(target)
    else:
        summary, _cost = fetch_summary(target)
    if has_history(target):
        try:
            trends, new_lost, _history_cost = fetch_history(target.hostname, utc_today())
        except DataForSeoError as error:
            logger.warning('seo.backlinks.history-failed code=%s', error.code)
            history_failed = True
    payload = {
        'summary': summary, 'trends': trends, 'new_lost_trends': new_lost, 'history_failed': history_failed,
        'fetched_at': get_timestamp(),
    }
    ttl = PARTIAL_OVERVIEW_TTL_SECONDS if history_failed else None
    OVERVIEW_CACHE.put(target_params(target), payload, ttl_seconds=ttl)
    return payload


def usable_payload(payload: object, list_field: str) -> Mapping[str, Any] | None:
    """A cached answer of the current shape (its ``list_field`` list and ``fetched_at``); anything else is a miss."""
    if not isinstance(payload, Mapping):
        return None
    shaped = isinstance(payload.get(list_field), list) and isinstance(payload.get('fetched_at'), str)
    return payload if shaped else None


@json_object_body
@validate(TARGET_SCHEMA)
@backlinks_errors
def handle_overview(event: dict[str, Any], _context: Any, *, target: str, scope: str | None,
                    **_request: Any) -> dict[str, Any]:
    """POST /api/seo/backlinks/overview."""
    resolved = backlinks_target(target, scope)
    cached = usable_payload(OVERVIEW_CACHE.get(target_params(resolved)), 'trends')
    payload = cached if cached is not None else fresh_overview(resolved)
    return success_response({
        **target_json(resolved),
        'summary': payload.get('summary'),
        'trends': payload.get('trends'),
        'new_lost_trends': payload.get('new_lost_trends') or [],
        'history_available': has_history(resolved),
        'history_includes_subdomains': has_history(resolved),
        'history_failed': bool(payload.get('history_failed')),
        'fetched_at': payload.get('fetched_at'),
        'estimated_cost_usd': 0.0 if cached is not None else overview_cost_usd(resolved),
        'cached': cached is not None,
    }, event)


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

def link_mode(value: str) -> Mode:
    """The validated ``mode`` field as a ``Mode`` (``@validate`` already refused anything else)."""
    return 'as_is' if value == 'as_is' else 'one_per_domain'


def has_more(offset: int, rows: int, page_size: int, total: int | None) -> bool:
    """More rows after this page: from DataForSEO's total, or a full page when the total is unknown."""
    return offset + rows < total if total is not None else rows == page_size


def table_handler(tab: Tab) -> Handler:
    """The POST handler of one table."""
    @json_object_body
    @validate(TABLE_SCHEMA)
    @backlinks_errors
    def handle_table(event: dict[str, Any], _context: Any, *, body: dict[str, Any], target: str, scope: str | None,
                     page: int, page_size: int, sort_field: str | None, sort_order: str, include_spam: bool,
                     mode: str, offset: int | None, limit: int | None, **_request: Any) -> dict[str, Any]:
        window = row_window(body, page=page, page_size=page_size, offset=offset, limit=limit)
        resolved = backlinks_target(target, scope)
        if tab == 'referring_domains' and resolved.scope == 'subfolder':
            return seo_error(400, 'VALIDATION_ERROR', SUBFOLDER_DOMAINS_MESSAGE, event, 'scope')
        filters = parse_filters(tab, body.get('filters'))
        built = build_filters(tab, filters, resolved, hide_spam=not include_spam)
        query = TableQuery(
            tab=tab, limit=window.limit, offset=window.offset, order_by=order_by(tab, sort_field, sort_order),
            filters=built.expression, mode=link_mode(mode) if tab == 'backlinks' else None,
        )
        params = {
            **target_params(resolved), 'tab': tab, **window.cache_key, 'order_by': query.order_by,
            'filters': filters, 'mode': query.mode, 'hide_spam': not include_spam,
        }
        cached = usable_payload(TABLE_CACHE.get(params), 'rows')
        payload = cached if cached is not None else fresh_table(resolved, query, params)
        return success_response({
            **target_json(resolved),
            'tab': tab,
            'rows': payload['rows'],
            'total_count': payload.get('total_count'),
            'has_more': has_more(query.offset, len(payload['rows']), query.limit, payload.get('total_count')),
            'page': page,
            'page_size': page_size,
            **window.echo(),
            'conditions_used': built.conditions,
            'condition_limit': condition_limit(tab, resolved, hide_spam=not include_spam),
            'cached': cached is not None,
            'fetched_at': payload['fetched_at'],
            'estimated_cost_usd': 0.0 if cached is not None else backlinks_usd(query.limit),
            'export': BACKLINKS_EXPORT,
        }, event)

    return handle_table


def fresh_table(target: BacklinksTarget, query: TableQuery, params: Mapping[str, Any]) -> dict[str, Any]:
    page = fetch_table(target, query)
    payload = {'rows': page.rows, 'total_count': page.total_count, 'fetched_at': get_timestamp()}
    TABLE_CACHE.put(params, payload, ttl_seconds=None if page.rows else EMPTY_TABLE_TTL_SECONDS)
    return payload


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------

@functools.cache
def step_functions() -> Any:
    return boto3.client('stepfunctions')


def handle_snapshots(event: dict[str, Any], _context: Any, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
    """GET /api/seo/backlinks/snapshots - every tracked domain with its stored snapshots, oldest first."""
    table = snapshots_table()
    domains = tracked_domains(brand_config())
    return success_response({
        'schedule_enabled': schedule_enabled(table),
        'estimated_run_cost_usd': round(len(domains) * SUMMARY_USD, 6),
        'domains': [{
            'domain': tracked.domain, 'role': tracked.role, 'competitor': tracked.competitor,
            'snapshots': domain_history(table, tracked.domain),
        } for tracked in domains],
    }, event)


@require_group(ADMIN_GROUP)
def handle_snapshot_now(event: dict[str, Any], _context: Any, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
    """POST /api/seo/backlinks/snapshots (Admin) - start one snapshot run; refused while one is running."""
    arn = os.environ.get(STATE_MACHINE_ENV, '')
    if not arn:
        return seo_error(503, 'NOT_CONFIGURED', 'Backlink snapshots are not deployed', event)
    domains = tracked_domains(brand_config())
    if not domains:
        return seo_error(400, 'VALIDATION_ERROR', 'Add your domains or competitor domains in Settings first', event)
    client = step_functions()
    running = client.list_executions(stateMachineArn=arn, statusFilter='RUNNING', maxResults=1).get('executions')
    if running:
        return seo_error(409, 'ALREADY_RUNNING', 'A snapshot run is already in progress', event)
    client.start_execution(
        stateMachineArn=arn, name=f'manual-{get_timestamp_compact()}',
        input=json.dumps({'step': 'backlinks.snapshot_all', 'scheduled': False,
                          'requested_by': get_caller_identity(event) or 'unknown'}),
    )
    return success_response({
        'started': True, 'domains': len(domains), 'estimated_cost_usd': round(len(domains) * SUMMARY_USD, 6),
    }, event, status_code=202)


@require_group(ADMIN_GROUP)
@json_object_body
@validate(SCHEDULE_SCHEMA)
def handle_schedule(event: dict[str, Any], _context: Any, *, enabled: bool, **_request: Any) -> dict[str, Any]:
    """PUT /api/seo/backlinks/snapshots/schedule (Admin) - ``{enabled}`` turns the weekly snapshot on or off."""
    set_schedule(snapshots_table(), enabled=enabled, updated_by=get_caller_identity(event), updated_at=get_timestamp())
    return success_response({'schedule_enabled': enabled}, event)


TABLE_ROUTES = {'backlinks': '/rows', 'referring_domains': '/referring-domains', 'top_pages': '/top-pages'}

handler = seo_route({
    ('POST', '/backlinks/overview'): handle_overview,
    **{('POST', f'/backlinks{TABLE_ROUTES[tab]}'): table_handler(tab) for tab in TABS},
    ('PUT', '/backlinks/snapshots/schedule'): handle_schedule,
    ('GET', '/backlinks/snapshots'): handle_snapshots,
    ('POST', '/backlinks/snapshots'): handle_snapshot_now,
})
