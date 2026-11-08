"""
Domain Overview API and SEO recommendations (shapes in ``web/src/types/api/seoDomains.ts``):

- POST /api/seo/domains/overview     - organic keywords, estimated traffic, traffic value, position buckets
- POST /api/seo/domains/keywords     - one page (or export chunk) of the keywords a target ranks for (sorted, filtered)
- POST /api/seo/domains/pages        - one page (or export chunk) of the target's top pages
- POST /api/seo/domains/competitors  - the domains ranking on a set of keywords (SERP competitors)
- GET  /api/seo/domains/snapshots    - stored estimated-traffic snapshots of a domain in a market
- POST /api/seo/domains/snapshots    - (Admin) take one snapshot now (starts the snapshot state machine)
- GET  /api/seo/domains/snapshots/schedule - whether the weekly sweep of every tracked domain is on
- PUT  /api/seo/domains/snapshots/schedule - (Admin) turn the weekly sweep on or off (off by default: it is paid)
- GET  /api/seo/insights             - SEO recommendations over the SEO vs GEO rows, with their status

The four lookups are live DataForSEO Labs calls (one each, never re-sent, each well under 20 s) open to every
signed-in user, POST because each is paid and runs only on an explicit request. Each answer is cached 12 h:
the overview only when it has data (a transient empty answer must not stick for 12 h; it is shared by every
scope of a host, since the endpoint is domain-wide), pages and competitors always (an empty page never
replaces a cached page with rows). A cache hit costs nothing (``estimated_cost_usd`` 0). Labs serves no
Google-Ads-only market: such a market is refused before any call.

Keywords and pages also serve the paid Excel export (``seo_export``): with ``limit`` (1..1000) and ``offset``
(0..9999, ``offset + limit`` <= 10,000) the call asks for those rows instead of the page, cached under its own key
and priced ``labs_usd(limit)``. Both answers echo ``offset``/``limit`` (``null`` on a page) and carry ``export``.

A snapshot runs as a job (two Labs calls of up to a minute each); the route starts the
``CitationAnalysis-SeoDomainSnapshots`` state machine with one target. Its execution name holds the domain,
market and hour, so a double click within the hour is 409 ``ALREADY_RUNNING`` instead of a second bill.
"""

import functools
import hashlib
import json
import logging
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

import boto3
from botocore.exceptions import ClientError
from seo_domain_requests import (
    FILTERS_FIELD,
    ORDER_FIELD,
    PAGE_FIELD,
    PAGE_SIZE_FIELD,
    SCOPE_FIELD,
    SEARCH_FIELD,
    TARGET_FIELD,
    DomainRequest,
    by_visibility,
    cache_params,
    competitor_json,
    domain_errors,
    domain_request,
    filters_json,
    keyword_filters,
    market_for_labs,
    page_filters,
    ranked_keyword_json,
    target_json,
    top_page_json,
)
from seo_export import EXPORT_SCHEMA, RowWindow, export_pricing, row_window
from seo_geo_data import SCOPE_QUERY_SCHEMA, load_seo_geo
from seo_http import MARKET_ID_FIELD, CachePolicy, dynamodb_table, keyword_list, seo_error, seo_route
from seo_schedule import schedule_setter

from shared.api_response import api_response, success_response
from shared.auth import ADMIN_GROUP, require_group
from shared.dataforseo_domain import (
    Page,
    domain_overview,
    overview_cost_usd,
    ranked_keywords,
    relevant_pages,
    serp_competitors,
)
from shared.dataforseo_domain_scope import parse_research_target
from shared.dataforseo_pricing import LABS_ROW_USD, LABS_TASK_USD, labs_usd
from shared.decorators import json_object_body, validate
from shared.domain_snapshots import SNAPSHOT_KEYWORD_LIMIT, list_snapshots, schedule_enabled, set_schedule, summary_json
from shared.dynamodb_batch import BatchGetUnprocessedError, batch_get_items
from shared.seo_insights import seo_recommendations
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)

OVERVIEW_CACHE = CachePolicy(namespace='domain-overview', version=1, ttl_seconds=43_200)
KEYWORDS_CACHE = CachePolicy(namespace='domain-keywords', version=2, ttl_seconds=43_200)
PAGES_CACHE = CachePolicy(namespace='domain-pages', version=1, ttl_seconds=43_200)
COMPETITORS_CACHE = CachePolicy(namespace='serp-competitors', version=1, ttl_seconds=43_200)

STATE_MACHINE_ENV = 'SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE_ARN'
STATUS_TABLE_ENV = 'DYNAMODB_TABLE_RECOMMENDATION_STATUS'
MAX_COMPETITOR_KEYWORDS = 200
COMPETITOR_LIMIT = 50
STATUS_FIELDS = ('status', 'notes', 'related_keyword', 'related_content_id')

DOMAIN_SCHEMA: dict[str, dict[str, Any]] = {'target': TARGET_FIELD, 'scope': SCOPE_FIELD, 'market_id': MARKET_ID_FIELD}
PAGED_SCHEMA: dict[str, dict[str, Any]] = {
    **DOMAIN_SCHEMA, 'page': PAGE_FIELD, 'page_size': PAGE_SIZE_FIELD, 'order': ORDER_FIELD, 'search': SEARCH_FIELD,
    'filters': FILTERS_FIELD, **EXPORT_SCHEMA,
}
PAGED_FIELDS = ('target', 'scope', 'market_id', 'sort', 'order', 'search', 'filters')
LABS_EXPORT = export_pricing(LABS_TASK_USD, LABS_ROW_USD)
KEYWORDS_SCHEMA = {**PAGED_SCHEMA, 'sort': {'type': str, 'choices': ['rank', 'traffic', 'volume', 'score', 'cpc'], 'default': 'traffic'}}
PAGES_SCHEMA = {**PAGED_SCHEMA, 'sort': {'type': str, 'choices': ['traffic', 'keywords'], 'default': 'traffic'}}
COMPETITORS_SCHEMA: dict[str, dict[str, Any]] = {'market_id': MARKET_ID_FIELD, 'include_subdomains': {'type': bool, 'default': True}}
SNAPSHOT_SCHEMA: dict[str, dict[str, Any]] = {'domain': TARGET_FIELD, 'market_id': MARKET_ID_FIELD}
SNAPSHOT_QUERY_SCHEMA = {key: {**rules, 'source': 'query'} for key, rules in SNAPSHOT_SCHEMA.items()}


def _cached_answer(payload: dict[str, Any], *, cached: bool, cost_usd: float) -> dict[str, Any]:
    return {**payload, 'cached': cached, 'estimated_cost_usd': 0.0 if cached else round(cost_usd, 6)}


# ---------------------------------------------------------------------------
# Live lookups
# ---------------------------------------------------------------------------

def _overview_payload(request: DomainRequest) -> tuple[dict[str, Any], bool]:
    params = {key: value for key, value in cache_params(request).items() if key in ('hostname', 'location_code', 'language_code')}
    cached = OVERVIEW_CACHE.get(params)
    if isinstance(cached, dict) and cached.get('has_data'):
        return cached, True
    overview = domain_overview(request.target.hostname, request.codes)
    payload = {
        'organic_keywords': overview.organic_keywords,
        'estimated_traffic': overview.estimated_traffic,
        'traffic_cost': overview.traffic_cost,
        'position_buckets': [{'label': label, 'keywords': count} for label, count in overview.position_buckets],
        'has_data': overview.has_data,
        'fetched_at': get_timestamp(),
    }
    if overview.has_data:
        OVERVIEW_CACHE.put(params, payload)
    return payload, False


@json_object_body
@validate(DOMAIN_SCHEMA)
@domain_errors
def handle_overview(event: dict[str, Any], _context: Any, *, target: str, scope: str | None, market_id: str | None,
                    **_request: Any) -> dict[str, Any]:
    """POST /api/seo/domains/overview - the domain-wide overview of the target's host."""
    request = domain_request(target, scope, market_id)
    payload, hit = _overview_payload(request)
    return success_response({
        **target_json(request), 'domain_wide': request.target.scope != 'subdomains',
        **_cached_answer(payload, cached=hit, cost_usd=overview_cost_usd()),
    }, event)


@dataclass(frozen=True)
class PagedLookup:
    """One paged Labs list: its cache, its filter parser, its call and its row shape."""

    policy: CachePolicy
    parse_filters: Callable[[object], Any]
    fetch: Callable[..., Page[Any]]
    row_json: Callable[[Any], dict[str, Any]]


KEYWORDS_LOOKUP = PagedLookup(KEYWORDS_CACHE, keyword_filters, ranked_keywords, ranked_keyword_json)
PAGES_LOOKUP = PagedLookup(PAGES_CACHE, page_filters, relevant_pages, top_page_json)


def paged_answer(lookup: PagedLookup, window: RowWindow, *, target: str, scope: str | None,
                 market_id: str | None, sort: str, order: str, search: str | None,
                 filters: object) -> dict[str, Any]:
    """The rows of ``window`` (a page or an export chunk): cached, else one paid call (filters checked first)."""
    request = domain_request(target, scope, market_id)
    parsed = lookup.parse_filters(filters)
    params = cache_params(request, **window.cache_key, sort=sort, order=order, filters=filters_json(parsed),
                          search=search or '')
    cached = lookup.policy.get(params)
    if isinstance(cached, dict) and isinstance(cached.get('items'), list):
        return {**target_json(request), **_cached_answer(cached, cached=True, cost_usd=0.0)}
    rows = lookup.fetch(request.target, request.codes, limit=window.limit, offset=window.offset, sort=sort,
                        order=order, filters=parsed, search=search)
    payload = {'total_count': rows.total_count, 'has_more': rows.has_more, 'fetched_at': get_timestamp(),
               'items': [lookup.row_json(row) for row in rows.items]}
    lookup.policy.put(params, payload)
    return {**target_json(request), **_cached_answer(payload, cached=False, cost_usd=labs_usd(window.limit))}


def paged_response(event: dict[str, Any], lookup: PagedLookup, request: dict[str, Any]) -> dict[str, Any]:
    """The answer of a paged route: its rows, the request's page (or export window) and the export prices."""
    page, page_size = request['page'], request['page_size']
    window = row_window(request['body'], page=page, page_size=page_size, offset=request['offset'],
                        limit=request['limit'])
    answer = paged_answer(lookup, window, **{key: request[key] for key in PAGED_FIELDS})
    return success_response({
        **answer, 'page': page, 'page_size': page_size, **window.echo(), 'export': LABS_EXPORT,
    }, event)


@json_object_body
@validate(KEYWORDS_SCHEMA)
@domain_errors
def handle_keywords(event: dict[str, Any], _context: Any, **request: Any) -> dict[str, Any]:
    """POST /api/seo/domains/keywords - one page (or export chunk) of ranked keywords."""
    return paged_response(event, KEYWORDS_LOOKUP, request)


@json_object_body
@validate(PAGES_SCHEMA)
@domain_errors
def handle_pages(event: dict[str, Any], _context: Any, **request: Any) -> dict[str, Any]:
    """POST /api/seo/domains/pages - one page (or export chunk) of top pages."""
    return paged_response(event, PAGES_LOOKUP, request)


@json_object_body
@validate(COMPETITORS_SCHEMA)
def handle_competitors(event: dict[str, Any], _context: Any, *, body: dict[str, Any], market_id: str | None,
                       include_subdomains: bool, **_request: Any) -> dict[str, Any]:
    """POST /api/seo/domains/competitors - the domains ranking on up to 200 keywords."""
    keywords, error = keyword_list(body.get('keywords'), 'keywords', MAX_COMPETITOR_KEYWORDS)
    if keywords is None:
        return seo_error(400, 'VALIDATION_ERROR', error or 'keywords is invalid', event, 'keywords')
    resolved_id, codes = market_for_labs(market_id)
    params = {'keywords': sorted(keywords), 'location_code': codes.location_code, 'language_code': codes.language_code,
              'include_subdomains': include_subdomains}
    cached = COMPETITORS_CACHE.get(params)
    hit = isinstance(cached, dict) and isinstance(cached.get('items'), list)
    payload: dict[str, Any] = cached if isinstance(cached, dict) and hit else _fresh_competitors(
        keywords, codes, include_subdomains, params,
    )
    return success_response({
        'market_id': resolved_id, 'keywords_count': len(keywords),
        **_cached_answer(payload, cached=hit, cost_usd=labs_usd(COMPETITOR_LIMIT)),
    }, event)


def _fresh_competitors(keywords: list[str], codes: Any, include_subdomains: bool, params: dict[str, Any]) -> dict[str, Any]:
    rows, _cost = serp_competitors(keywords, codes, limit=COMPETITOR_LIMIT, include_subdomains=include_subdomains)
    payload = {'items': by_visibility([competitor_json(row) for row in rows]), 'fetched_at': get_timestamp()}
    COMPETITORS_CACHE.put(params, payload)
    return payload


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------

@functools.cache
def snapshots_table() -> Any:
    return dynamodb_table('DYNAMODB_TABLE_SEO_DOMAIN_SNAPSHOTS')


@functools.cache
def step_functions() -> Any:
    return boto3.client('stepfunctions')


@validate(SNAPSHOT_QUERY_SCHEMA)
@domain_errors
def handle_list_snapshots(event: dict[str, Any], _context: Any, *, domain: str, market_id: str | None,
                          **_request: Any) -> dict[str, Any]:
    """GET /api/seo/domains/snapshots - a domain's snapshots in a market, newest first."""
    hostname = parse_research_target(domain).hostname
    resolved_id, _codes = market_for_labs(market_id)
    items = list_snapshots(snapshots_table(), hostname, resolved_id)
    return success_response({
        'domain': hostname, 'market_id': resolved_id, 'source': 'dataforseo_labs', 'estimated': True,
        'snapshots': [summary_json(item) for item in items],
    }, event)


def execution_name(hostname: str, market_id: str, now: datetime) -> str:
    """``manual-<hash of domain and market>-<UTC hour>``: one manual snapshot per pair per hour."""
    digest = hashlib.sha256(f'{hostname}#{market_id}'.encode()).hexdigest()[:16]
    return f'manual-{digest}-{now.strftime("%Y%m%d%H")}'


def already_started(error: ClientError) -> bool:
    """Whether ``StartExecution`` refused a name already used: this hour's snapshot of the pair exists."""
    return (error.response.get('Error') or {}).get('Code') == 'ExecutionAlreadyExists'


@require_group(ADMIN_GROUP)
@json_object_body
@validate(SNAPSHOT_SCHEMA)
@domain_errors
def handle_take_snapshot(event: dict[str, Any], _context: Any, *, domain: str, market_id: str | None,
                         **_request: Any) -> dict[str, Any]:
    """POST /api/seo/domains/snapshots - (Admin) snapshot one domain in one market now."""
    hostname = parse_research_target(domain).hostname
    resolved_id, _codes = market_for_labs(market_id)
    name = execution_name(hostname, resolved_id, datetime.now(UTC))
    try:
        step_functions().start_execution(
            stateMachineArn=os.environ[STATE_MACHINE_ENV], name=name,
            input=json.dumps({'targets': [{'domain': hostname, 'market_id': resolved_id}]}),
        )
    except ClientError as error:
        if not already_started(error):
            raise
        return seo_error(409, 'ALREADY_RUNNING', 'A snapshot of this domain was already started this hour', event)
    return api_response(202, {
        'domain': hostname, 'market_id': resolved_id, 'execution': name,
        'estimated_cost_usd': round(overview_cost_usd() + labs_usd(SNAPSHOT_KEYWORD_LIMIT), 6),
    }, event)


def handle_get_schedule(event: dict[str, Any], _context: Any, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
    """GET /api/seo/domains/snapshots/schedule - whether the weekly sweep is on."""
    return success_response({'schedule_enabled': schedule_enabled(snapshots_table())}, event)


#: PUT /api/seo/domains/snapshots/schedule (Admin) - ``{enabled}`` turns the weekly sweep on or off.
handle_set_schedule = schedule_setter(lambda **choice: set_schedule(snapshots_table(), **choice))


# ---------------------------------------------------------------------------
# SEO recommendations
# ---------------------------------------------------------------------------

@functools.cache
def status_resource() -> Any:
    return boto3.resource('dynamodb')


def stored_statuses(ids: list[str]) -> dict[str, dict[str, Any]]:
    """The Action Center status rows of ``ids``; ``{}`` when the table cannot be read (status is auxiliary)."""
    if not ids:
        return {}
    try:
        items = batch_get_items(status_resource(), os.environ[STATUS_TABLE_ENV],
                                [{'recommendation_id': key} for key in dict.fromkeys(ids)])
    except (ClientError, BatchGetUnprocessedError):
        logger.exception('recommendation status join skipped')
        return {}
    return {str(item.get('recommendation_id')): item for item in items}


@validate(SCOPE_QUERY_SCHEMA)
def handle_insights(event: dict[str, Any], _context: Any, *, market_id: str | None, group_id: str | None,
                    **_request: Any) -> dict[str, Any]:
    """GET /api/seo/insights - the SEO recommendations of a market (and keyword group)."""
    data = load_seo_geo(market_id, group_id)
    recommendations = seo_recommendations(data.rows)
    statuses = stored_statuses([item['id'] for item in recommendations])
    for item in recommendations:
        row = statuses.get(item['id'], {})
        item.update({field: str(row[field]) for field in STATUS_FIELDS if row.get(field)})
        item.setdefault('status', 'new')
    return success_response({
        'market_id': data.market_id, 'group_id': data.group_id, 'generated_at': get_timestamp(),
        'recommendations': recommendations, 'total_count': len(recommendations),
    }, event)


handler = seo_route({
    ('POST', '/domains/overview'): handle_overview,
    ('POST', '/domains/keywords'): handle_keywords,
    ('POST', '/domains/pages'): handle_pages,
    ('POST', '/domains/competitors'): handle_competitors,
    # Before '/domains/snapshots': a route matches when its path is a segment run of the request's.
    ('GET', '/domains/snapshots/schedule'): handle_get_schedule,
    ('PUT', '/domains/snapshots/schedule'): handle_set_schedule,
    ('GET', '/domains/snapshots'): handle_list_snapshots,
    ('POST', '/domains/snapshots'): handle_take_snapshot,
    ('GET', '/insights'): handle_insights,
})
