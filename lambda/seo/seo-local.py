"""
Local SEO API (response shapes in ``web/src/types/api/seoLocal.ts``); every route is open to signed-in users:
each paid route is a one-off lookup, nothing here schedules recurring spend.

- GET  /api/seo/local/categories   - business categories (free), cached 7 d as one entry, filtered here
- POST /api/seo/local/businesses   - business listings near a point (cached 24 h)
- GET  /api/seo/local/businesses   - the same search from the cache only (``count`` = ``limit``); 404 ``NOT_CACHED``
- POST /api/seo/local/profile      - one Google Business Profile (cached 24 h)
- POST /api/seo/local/questions    - its questions and answers (cached 24 h)
- POST /api/seo/local/serp         - Maps / Local Finder results and where a business sits in them (cached 12 h)
- GET  /api/seo/local/serp         - the same results from the cache only; 404 ``NOT_CACHED``
- POST /api/seo/local/jobs         - start a queued job: reviews, profile updates or a rank grid
- GET  /api/seo/local/jobs/{id}    - a job's status and results (free; the dashboard polls it)

Paid answers carry ``estimated_cost_usd`` (0 when served from the cache). An empty answer is cached for 1 h only,
and never replaces a cached non-empty one. The GET twins of the paid searches never call DataForSEO: the export
service replays them (``shared.export_source_seo_stored``), so an export never pays. Listings come sorted by
``sort_by`` (rating or reviews, highest first, unknown last), as the table shows them. Jobs run in the
``CitationAnalysis-SeoLocalJob`` state machine; a repeated job request within the hour reuses its receipt
(``shared.local_seo_jobs``) instead of buying again.
"""

import json
import logging
import os
import re
import sys
from collections.abc import Callable, Mapping, Sequence
from functools import cache
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

import boto3
import local_requests as req
from botocore.exceptions import BotoCoreError, ClientError
from seo_http import CachePolicy, seo_error, seo_route

from shared import dataforseo_business as business
from shared import dataforseo_local_serp as local_serp
from shared import local_seo_pricing as pricing
from shared.api_response import success_response
from shared.dataforseo_business_tasks import REVIEW_SORTS
from shared.decorators import json_object_body, validate
from shared.local_rank_grid import GRID_SIZES, MAX_SPACING_KM, MIN_SPACING_KM, RANK_GRID_DEPTH, grid_zoom
from shared.local_seo_jobs import (
    KINDS,
    fail_job,
    grid_target,
    job_view,
    load_job,
    new_job,
    put_receipt,
    receipt_job,
    save_job,
)
from shared.seo_spend_limit import release_queued_calls, reserve_queued_calls
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)

STATE_MACHINE_ENV = 'SEO_LOCAL_JOB_STATE_MACHINE_ARN'
CATEGORIES_CACHE = CachePolicy(namespace='local-categories', version=1, ttl_seconds=7 * 86_400)
LISTINGS_CACHE = CachePolicy(namespace='local-listings', version=1, ttl_seconds=86_400)
PROFILE_CACHE = CachePolicy(namespace='local-profile', version=1, ttl_seconds=86_400)
QUESTIONS_CACHE = CachePolicy(namespace='local-questions', version=1, ttl_seconds=86_400)
SERP_CACHE = CachePolicy(namespace='local-serp', version=1, ttl_seconds=43_200)
EMPTY_TTL_SECONDS = 3_600
JOB_ID = re.compile(r'^[0-9a-f]{32}$')
START_FAILED_MESSAGE = 'The job could not be started'

CATEGORIES_SCHEMA = {'query': {'type': str, 'max_length': 80}, 'limit': {'type': int, 'min': 1, 'max': 200, 'default': 50}}
BUSINESSES_SCHEMA = {
    'query': {'type': str, 'max_length': 200}, **req.POINT_SCHEMA,
    'radius_km': {'type': float, 'min': 1, 'max': 100, 'default': 10.0},
    'min_rating': {'type': float, 'min': 1, 'max': 5}, 'min_reviews': {'type': int, 'min': 0, 'max': 1_000_000},
    'is_claimed': {'type': bool}, 'sort_by': {'type': str, 'choices': ['relevance', 'rating', 'reviews'], 'default': 'relevance'},
    'limit': {'type': int, 'min': 1, 'max': 50, 'default': 20}, 'offset': {'type': int, 'min': 0, 'max': 1000, 'default': 0},
}
RADIUS_FIELD = {'type': float, 'min': 0.2, 'max': 199, 'default': 10.0}
PROFILE_SCHEMA = {**req.IDENTITY_SCHEMA, **req.POINT_SCHEMA, 'radius_km': RADIUS_FIELD}
QUESTIONS_SCHEMA = {**PROFILE_SCHEMA, 'depth': {'type': int, 'min': 1, 'max': 100, 'default': 20}}
TARGET_SCHEMA = {**req.IDENTITY_SCHEMA, 'domain': req.DOMAIN_FIELD}
SERP_SCHEMA = {
    'keyword': {'required': True, 'type': str, 'min_length': 1, 'max_length': 120}, **req.POINT_SCHEMA, **TARGET_SCHEMA,
    'zoom': {'type': int, 'min': local_serp.MIN_ZOOM, 'max': local_serp.MAX_ZOOM, 'default': local_serp.DEFAULT_ZOOM},
    'search_type': {'type': str, 'choices': ['maps', 'local_finder'], 'default': 'maps'},
    'device': {'type': str, 'choices': ['mobile', 'desktop'], 'default': 'mobile'},
    'depth': {'type': int, 'min': 1, 'max': 100, 'default': 20},
}
JOB_SCHEMA = {
    'kind': {'required': True, 'type': str, 'choices': list(KINDS)},
    'keyword': {'type': str, 'min_length': 1, 'max_length': 120}, **req.POINT_SCHEMA, **TARGET_SCHEMA,
    'radius_km': RADIUS_FIELD, 'depth': {'type': int, 'min': 10, 'max': 200},
    'sort_by': {'type': str, 'choices': list(REVIEW_SORTS), 'default': 'newest'},
    'grid_size': {'type': int, 'choices': list(GRID_SIZES), 'default': 3},
    'spacing_km': {'type': float, 'min': MIN_SPACING_KM, 'max': MAX_SPACING_KM, 'default': 2.0},
    'zoom': {'type': int, 'min': local_serp.MIN_ZOOM, 'max': local_serp.MAX_ZOOM},
    'device': {'type': str, 'choices': ['mobile', 'desktop'], 'default': 'mobile'},
}
DEPTH_LIMITS = {'reviews': (10, 200, 20), 'updates': (10, 100, 10)}
#: The listing field each ``sort_by`` orders the listings table by (``relevance`` keeps DataForSEO's order).
LISTING_SORT_FIELDS = {'rating': 'rating', 'reviews': 'reviews_count'}

_PAGING_FIELDS = ('limit', 'offset')
#: ``GET /businesses``: a POST's search as query parameters; ``count`` is its ``limit`` (exports drop paging names).
CACHED_BUSINESSES_SCHEMA = {
    **{name: rules for name, rules in BUSINESSES_SCHEMA.items() if name not in _PAGING_FIELDS},
    'count': BUSINESSES_SCHEMA['limit'], 'categories': {'type': str, 'max_length': 1_000},
}


def cached_read(policy: CachePolicy, params: Mapping[str, Any], fetch: Callable[[], tuple[list[Any], dict[str, Any]]],
                *, cache_only: bool) -> tuple[Mapping[str, Any] | None, bool]:
    """``read_through``; with ``cache_only``, the cached payload or ``(None, False)``, never a paid call."""
    if not cache_only:
        return read_through(policy, params, fetch)
    payload = cached_or(policy, params)
    return payload, payload is not None


def not_cached(event: dict[str, Any], what: str) -> dict[str, Any]:
    return seo_error(404, 'NOT_CACHED', f'This {what} is no longer cached: search again, then export', event)


def cached_or(policy: CachePolicy, params: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """A cached ``{items, fetched_at, ...}`` payload of the current shape, else ``None``."""
    payload = policy.get(params)
    if isinstance(payload, Mapping) and isinstance(payload.get('items'), list) and isinstance(payload.get('fetched_at'), str):
        return payload
    return None


def store(policy: CachePolicy, params: Mapping[str, Any], items: list[Any], **extra: Any) -> dict[str, Any]:
    payload = {'items': items, 'fetched_at': get_timestamp(), **extra}
    policy.put(params, payload, None if items else EMPTY_TTL_SECONDS)
    return payload


def read_through(policy: CachePolicy, params: Mapping[str, Any],
                 fetch: Callable[[], tuple[list[Any], dict[str, Any]]]) -> tuple[Mapping[str, Any], bool]:
    """``(payload, hit)``: the cached payload, else ``fetch()``'s ``(items, extra fields)`` stored and answered."""
    payload = cached_or(policy, params)
    if payload is not None:
        return payload, True
    items, extra = fetch()
    return store(policy, params, items, **extra), False


def paid_answer(event: dict[str, Any], body: dict[str, Any], hit: bool, cost: float) -> dict[str, Any]:
    return success_response({**body, 'cached': hit, 'estimated_cost_usd': 0.0 if hit else cost}, event)


@validate(CATEGORIES_SCHEMA)
def handle_categories(event: dict[str, Any], _context: Any, *, query: str | None, limit: int, **_r: Any) -> dict[str, Any]:
    """GET /categories - free, so a miss simply refills the one entry."""
    payload = cached_or(CATEGORIES_CACHE, {})
    if payload is None:
        payload = store(CATEGORIES_CACHE, {}, business.listing_categories())
    needle = (query or '').strip().lower()
    matches = [row for row in payload['items'] if needle in str(row.get('category', '')).lower()]
    return success_response({'categories': matches[:limit], 'total': len(matches)}, event)


@req.local_errors
@json_object_body
@validate(BUSINESSES_SCHEMA)
def handle_businesses(event: dict[str, Any], _context: Any, *, body: dict[str, Any], **fields: Any) -> dict[str, Any]:
    """POST /businesses - listings near a point, by name and/or category."""
    return listings_answer(event, fields, req.categories(body.get('categories')), cache_only=False)


@req.local_errors
@validate(CACHED_BUSINESSES_SCHEMA)
def handle_cached_businesses(event: dict[str, Any], _context: Any, *, count: int, categories: str | None,
                             **fields: Any) -> dict[str, Any]:
    """GET /businesses - the listings a POST cached, from the cache only (the export of the listings table)."""
    named = req.categories([part for part in (categories or '').split(',') if part.strip()])
    return listings_answer(event, {**fields, 'limit': count, 'offset': 0}, named, cache_only=True)


def sorted_listings(items: Sequence[Any], sort_by: str) -> list[Any]:
    """
    The listings as the table shows them: by rating or reviews, highest first, unknown values last.

    DataForSEO's own order only roughly follows ``order_by``; equal values (and ``relevance``) keep its order.
    """
    field = LISTING_SORT_FIELDS.get(sort_by)
    if field is None:
        return list(items)
    ranked = sorted((item for item in items if _number_at(item, field) is not None),
                    key=lambda item: _number_at(item, field) or 0.0, reverse=True)
    return [*ranked, *(item for item in items if _number_at(item, field) is None)]


def _number_at(item: Any, field: str) -> float | None:
    value = item.get(field) if isinstance(item, Mapping) else None
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def listings_answer(event: dict[str, Any], fields: Mapping[str, Any], categories: tuple[str, ...], *,
                    cache_only: bool) -> dict[str, Any]:
    """The listings of a search (``fields`` as ``BUSINESSES_SCHEMA`` validates them), fetched unless ``cache_only``."""
    near = req.required_near(fields['latitude'], fields['longitude'], fields['radius_km'],
                             req.local_market(fields['market_id']))
    search = business.ListingsQuery(
        near=near, title=(fields['query'] or '').strip() or None, categories=categories,
        min_rating=fields['min_rating'], min_reviews=fields['min_reviews'], is_claimed=fields['is_claimed'],
        sort_by=fields['sort_by'], limit=fields['limit'], offset=fields['offset'],
    )
    payload, hit = cached_read(LISTINGS_CACHE, business.listings_body(search),
                               lambda: (business.search_listings(search)[0], {}), cache_only=cache_only)
    if payload is None:
        return not_cached(event, 'business search')
    return paid_answer(event, {'businesses': sorted_listings(payload['items'], search.sort_by),
                               'center': req.near_json(near), 'fetched_at': payload['fetched_at']},
                       hit, pricing.listings_search_usd(search.limit))


def identity_and_market(fields: Mapping[str, Any]) -> tuple[business.BusinessIdentifier, req.LocalMarket]:
    return req.identifier(fields['name'], fields['cid'], fields['place_id']), req.local_market(fields['market_id'])


@req.local_errors
@json_object_body
@validate(PROFILE_SCHEMA)
def handle_profile(event: dict[str, Any], _context: Any, **fields: Any) -> dict[str, Any]:
    """POST /profile - the coordinate when given, else the market's location code."""
    identity, market = identity_and_market(fields)
    near = req.explicit_near(fields['latitude'], fields['longitude'], fields['radius_km'])
    params = {'identifier': identity.as_json(), 'near': req.near_json(near),
              'location_code': market.codes.location_code, 'language_code': market.codes.language_code}

    def fetch() -> tuple[list[Any], dict[str, Any]]:
        profile, _cost = business.business_profile(identity, near, market.codes.location_code, market.codes.language_code)
        return ([profile] if profile else []), {}

    payload, hit = read_through(PROFILE_CACHE, params, fetch)
    items = payload['items']
    return paid_answer(event, {'profile': items[0] if items else None, 'fetched_at': payload['fetched_at']}, hit,
                       pricing.BUSINESS_INFO_USD)


@req.local_errors
@json_object_body
@validate(QUESTIONS_SCHEMA)
def handle_questions(event: dict[str, Any], _context: Any, **fields: Any) -> dict[str, Any]:
    """POST /questions - Google may hold no Q&A for a business; that is an empty list, not an error."""
    identity, market = identity_and_market(fields)
    depth = fields['depth']
    near = req.required_near(fields['latitude'], fields['longitude'], fields['radius_km'], market)
    params = {'identifier': identity.as_json(), 'near': req.near_json(near),
              'language_code': market.codes.language_code, 'depth': depth}
    payload, hit = read_through(QUESTIONS_CACHE, params, lambda: (
        business.business_questions(identity, near, market.codes.language_code, depth)[0], {}))
    return paid_answer(event, {'questions': payload['items'], 'fetched_at': payload['fetched_at']}, hit,
                       pricing.questions_usd(depth))


def match_json(items: list[dict[str, Any]], target: local_serp.BusinessTarget) -> dict[str, Any] | None:
    match = local_serp.match_business(items, target)
    if match is None:
        return None
    index = next(position for position, item in enumerate(items) if item is match)
    return {'index': index, 'rank': local_serp.item_rank(match), **local_serp.business_identity(match)}


@req.local_errors
@json_object_body
@validate(SERP_SCHEMA)
def handle_serp(event: dict[str, Any], _context: Any, **fields: Any) -> dict[str, Any]:
    """POST /serp - the target only decides which result is "yours", so it is not part of the cache key."""
    return serp_answer(event, fields, cache_only=False)


@req.local_errors
@validate(SERP_SCHEMA)
def handle_cached_serp(event: dict[str, Any], _context: Any, **fields: Any) -> dict[str, Any]:
    """GET /serp - the results a POST cached, from the cache only (the export of the local results table)."""
    return serp_answer(event, fields, cache_only=True)


def serp_answer(event: dict[str, Any], fields: Mapping[str, Any], *, cache_only: bool) -> dict[str, Any]:
    """The Maps / Local Finder results of ``fields`` (as ``SERP_SCHEMA`` validates them), fetched unless ``cache_only``."""
    market = req.local_market(fields['market_id'])
    near = req.required_near(fields['latitude'], fields['longitude'], None, market)
    search_type = fields['search_type']
    search = local_serp.LocalSearch(keyword=fields['keyword'].strip(), latitude=near.latitude, longitude=near.longitude,
                                    language_code=market.codes.language_code, search_type=search_type,
                                    device=fields['device'], depth=fields['depth'], zoom=fields['zoom'])
    def fetch() -> tuple[list[Any], dict[str, Any]]:
        items, check_url, _cost = local_serp.local_serp(search)
        return items, {'check_url': check_url}

    payload, hit = cached_read(SERP_CACHE, local_serp.local_body(search), fetch, cache_only=cache_only)
    if payload is None:
        return not_cached(event, 'local results search')
    items = payload['items']
    return paid_answer(event, {
        'keyword': search.keyword, 'search_type': search_type, 'items': items,
        'match': match_json(items, req.target(fields['cid'], fields['place_id'], fields['domain'], fields['name'])),
        'check_url': payload.get('check_url'), 'fetched_at': payload['fetched_at'],
    }, hit, pricing.local_serp_usd(search_type, search.depth))


@cache
def stepfunctions_client() -> Any:
    return boto3.client('stepfunctions')


def start_execution(job: dict[str, Any]) -> bool:
    """Start (or restart, for a timed-out job) the job's state machine; a failure marks the job failed (``False``)."""
    job['runs'] = int(job.get('runs') or 0) + 1
    save_job(job)
    try:
        stepfunctions_client().start_execution(
            stateMachineArn=os.environ[STATE_MACHINE_ENV], name=f"{job['job_id']}-{job['runs']}",
            input=json.dumps({'job_id': job['job_id']}),
        )
    except (ClientError, BotoCoreError, KeyError) as error:
        logger.warning('local job %s could not start: %s', job['job_id'], type(error).__name__)
        fail_job(job, 'INTERNAL_ERROR', START_FAILED_MESSAGE)
        return False
    return True


def business_job_request(kind: str, args: dict[str, Any], market: req.LocalMarket) -> tuple[dict[str, Any], float]:
    low, high, default = DEPTH_LIMITS[kind]
    depth = args['depth'] if args['depth'] is not None else default
    if not low <= depth <= high:
        raise req.LocalRequestError(f'depth must be between {low} and {high} for {kind}', 'depth')
    identity = req.identifier(args['name'], args['cid'], args['place_id'])
    near = req.explicit_near(args['latitude'], args['longitude'], args['radius_km'])
    request = {'identifier': identity.as_json(), 'near': req.near_json(near),
               'location_code': market.codes.location_code, 'language_code': market.codes.language_code,
               'depth': depth, **({'sort_by': args['sort_by']} if kind == 'reviews' else {})}
    return request, pricing.reviews_usd(depth) if kind == 'reviews' else pricing.updates_usd(depth)


def grid_job_request(args: dict[str, Any], market: req.LocalMarket) -> tuple[dict[str, Any], float]:
    keyword = (args['keyword'] or '').strip()
    if not keyword:
        raise req.LocalRequestError('keyword is required for a rank grid', 'keyword')
    near = req.required_near(args['latitude'], args['longitude'], None, market)
    target = req.target(args['cid'], args['place_id'], args['domain'], args['name'])
    if target.is_empty:
        raise req.LocalRequestError('Name the business to find: cid, place_id, domain or name', 'cid')
    request = {
        'keyword': keyword, 'center': {'latitude': near.latitude, 'longitude': near.longitude},
        'grid_size': args['grid_size'], 'spacing_km': args['spacing_km'],
        'zoom': args['zoom'] if args['zoom'] is not None else grid_zoom(near.latitude, args['spacing_km']),
        'device': args['device'], 'language_code': market.codes.language_code, 'depth': RANK_GRID_DEPTH,
        'target': req.target_json(target),
    }
    return request, pricing.rank_grid_usd(args['grid_size'] ** 2)


@req.local_errors
@json_object_body
@validate(JOB_SCHEMA)
def handle_start_job(event: dict[str, Any], _context: Any, *, kind: str, market_id: str | None,
                     **args: Any) -> dict[str, Any]:
    """POST /jobs - reuse the receipt of an equal request within the hour, else create and start a job."""
    market = req.local_market(market_id)
    if kind == 'grid':
        request, cost = grid_job_request(args, market)
    else:
        request, cost = business_job_request(kind, args, market)
    job = receipt_job(kind, request)
    reused = job is not None
    if job is None:
        # The jobs Lambda posts the billed tasks: count them now (a grid's points, or one task), before it starts.
        reserve_queued_calls(args['grid_size'] ** 2 if kind == 'grid' else 1, f'local {kind} job')
        job = new_job(kind, request, cost)
        put_receipt(kind, request, job['job_id'])
        if not start_execution(job):
            # Nothing was posted, so nothing is billed: the calls counted for it go back to the user's day.
            release_queued_calls()
    elif job['status'] == 'timed_out':
        job['status'] = 'collecting'
        start_execution(job)
    target = grid_target(request['target']) if kind == 'grid' else None
    return success_response({'job_id': job['job_id'], 'reused': reused, 'job': job_view(job, target)}, event)


def path_job_id(event: dict[str, Any]) -> str:
    job_id = (event.get('pathParameters') or {}).get('job_id') or str(event.get('path', '')).rstrip('/').rsplit('/', 1)[-1]
    return job_id if isinstance(job_id, str) else ''


@validate(TARGET_SCHEMA)
def handle_job(event: dict[str, Any], _context: Any, *, name: str | None, cid: str | None, place_id: str | None,
               domain: str | None, **_r: Any) -> dict[str, Any]:
    """GET /jobs/{job_id} - free; a grid is ranked for the target in the query, else the one it started with."""
    job_id = path_job_id(event)
    job = load_job(job_id) if JOB_ID.match(job_id) else None
    if job is None:
        return seo_error(404, 'NOT_FOUND', 'Job not found or expired', event)
    asked = any((name, cid, place_id, domain))
    target = req.target(cid, place_id, domain, name) if asked and job['kind'] == 'grid' else None
    return success_response(job_view(job, target), event)


handler = seo_route({
    ('GET', '/categories'): handle_categories,
    ('POST', '/businesses'): handle_businesses,
    ('GET', '/businesses'): handle_cached_businesses,
    ('POST', '/profile'): handle_profile,
    ('POST', '/questions'): handle_questions,
    ('POST', '/serp'): handle_serp,
    ('GET', '/serp'): handle_cached_serp,
    ('POST', '/jobs'): handle_start_job,
    ('GET', '/jobs'): handle_job,
})
