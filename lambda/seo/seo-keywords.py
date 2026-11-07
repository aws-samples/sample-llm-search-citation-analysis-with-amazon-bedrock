"""
SEO Keyword Explorer API (response shapes in ``web/src/types/api/seo.ts``):

- POST /api/seo/keywords/research - keyword ideas for one seed in one market
- POST /api/seo/serp              - the organic Google results of one keyword in one market

Research: the request takes one seed, a limit of 150/300/500, one of the four modes and the clickstream and
group-keywords opt-ins, validated before any paid call. A Google-Ads-only market researches with ``mode=auto``
and neither clickstream nor grouping (the options Google Ads cannot honour are dropped), so equivalent requests
share a cache entry. Cached 24 h (namespace ``kw-research`` v1); an empty result is cached for 1 h, so repeating a
zero-result seed is free for an hour but a new crawl is soon possible (an empty entry never replaces a non-empty one).
A cache hit costs nothing (``estimated_cost_usd`` 0). Every fresh research stores its rows' metrics in
``CitationAnalysis-SeoKeywordMetrics``, so tracking a researched keyword needs no second paid metrics call; a
failed write is logged and never fails the answer.

SERP: cached 12 h (namespace ``serp`` v1) *without* the depth in the key: DataForSEO has no offset, so a deeper
snapshot also answers a shallower request (served as stored, with its own depth) and a deeper request replaces the
entry. An empty re-crawl never replaces a snapshot that has results: the cached snapshot is served instead
(``cached: true``, its own depth) and marked ``checked_depth`` so the next request at that depth does not pay again.

There is no local (city-level) research: a market is a country + language.
SERP depths are 20 | 50, not 100: a depth-100 live call does not reliably fit the 29 s API Gateway limit.
"""

import functools
import logging
import math
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

import boto3
from seo_http import KEYWORD_FIELD, MARKET_ID_FIELD, CachePolicy, MarketRequest, market_request, seo_route

from shared.api_response import success_response
from shared.dataforseo_keywords import KeywordRow, research_keywords
from shared.dataforseo_pricing import GOOGLE_ADS_LIVE_TASK_USD, labs_usd
from shared.dataforseo_serp import OrganicItem, organic_serp
from shared.decorators import json_object_body, validate
from shared.seo_keyword_metrics import metrics_table_name, persist_research_rows
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)

RESEARCH_CACHE = CachePolicy(namespace='kw-research', version=1, ttl_seconds=86_400)
EMPTY_RESEARCH_TTL_SECONDS = 3_600
SERP_CACHE = CachePolicy(namespace='serp', version=1, ttl_seconds=43_200)

MODES = ['auto', 'related', 'suggestions', 'ideas']
LIMITS = [150, 300, 500]
DEPTHS = [20, 50]
AI_OVERVIEW_ITEM_TYPE = 'ai_overview'

RESEARCH_SCHEMA: dict[str, dict[str, Any]] = {
    'keyword': KEYWORD_FIELD,
    'market_id': MARKET_ID_FIELD,
    'mode': {'type': str, 'choices': MODES, 'default': 'auto'},
    'limit': {'type': int, 'choices': LIMITS, 'default': 150},
    'group_keywords': {'type': bool, 'default': False},
    'clickstream': {'type': bool, 'default': False},
}

SERP_SCHEMA: dict[str, dict[str, Any]] = {
    'keyword': KEYWORD_FIELD,
    'market_id': MARKET_ID_FIELD,
    'depth': {'type': int, 'choices': DEPTHS, 'default': 20},
}


# ---------------------------------------------------------------------------
# Keyword research
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ResearchOptions:
    """The research DataForSEO is asked for, after the data-source normalization."""

    mode: str
    limit: int
    group_keywords: bool
    clickstream: bool


def effective_options(request: MarketRequest, mode: str, limit: int, *, group_keywords: bool,
                      clickstream: bool) -> ResearchOptions:
    """A Google Ads market has one mode and neither clickstream nor grouping; a Labs market takes them as asked."""
    if request.codes.keyword_data == 'google_ads':
        return ResearchOptions(mode='auto', limit=limit, group_keywords=False, clickstream=False)
    return ResearchOptions(mode=mode, limit=limit, group_keywords=group_keywords, clickstream=clickstream)


def estimated_cost_usd(request: MarketRequest, options: ResearchOptions) -> float:
    """The price of the research: auto = two Labs calls at half the limit, before any fallback."""
    if request.codes.keyword_data == 'google_ads':
        return GOOGLE_ADS_LIVE_TASK_USD
    if options.mode == 'auto':
        return round(2 * labs_usd(math.ceil(options.limit / 2), options.clickstream), 6)
    return round(labs_usd(options.limit, options.clickstream), 6)


def research_cache_params(request: MarketRequest, options: ResearchOptions) -> dict[str, Any]:
    return {
        'seed': request.keyword,
        'location_code': request.codes.location_code,
        'language_code': request.codes.language_code,
        'mode': options.mode,
        'limit': options.limit,
        'group_keywords': options.group_keywords,
        'clickstream': options.clickstream,
    }


def row_json(row: KeywordRow) -> dict[str, Any]:
    """The API ``KeywordRow`` of one research row."""
    return {
        'keyword': row.keyword,
        'search_volume': row.search_volume,
        'trend': [{'year': month.year, 'month': month.month, 'search_volume': month.search_volume} for month in row.trend],
        'keyword_difficulty': row.keyword_difficulty,
        'cpc': row.cpc,
        'competition': row.competition,
        'intent': row.intent,
    }


def usable_research(payload: object) -> Mapping[str, Any] | None:
    """A cached research payload (rows may be empty: a cached zero-result seed); anything else is a miss."""
    if not isinstance(payload, Mapping):
        return None
    if not isinstance(payload.get('rows'), list) or not isinstance(payload.get('fetched_at'), str):
        return None
    return payload


@functools.cache
def metrics_table() -> Any:
    """``CitationAnalysis-SeoKeywordMetrics``, opened once per container (tests replace this function)."""
    return boto3.resource('dynamodb').Table(metrics_table_name())


def fresh_research(request: MarketRequest, options: ResearchOptions) -> dict[str, Any]:
    result = research_keywords(
        request.keyword, request.codes, mode=options.mode, limit=options.limit,
        group_keywords=options.group_keywords, clickstream=options.clickstream,
    )
    fetched_at = get_timestamp()
    payload = {
        'source': result.source,
        'used_fallback': result.used_fallback,
        'rows': [row_json(row) for row in result.rows],
        'fetched_at': fetched_at,
    }
    params = research_cache_params(request, options)
    if payload['rows']:
        RESEARCH_CACHE.put(params, payload)
        persist_research_rows(metrics_table(), result.rows, request.market_id, request.codes.keyword_data, fetched_at)
    else:
        RESEARCH_CACHE.put(params, payload, ttl_seconds=EMPTY_RESEARCH_TTL_SECONDS)
    return payload


@json_object_body
@validate(RESEARCH_SCHEMA)
def handle_research(event: dict[str, Any], _context: Any, *, keyword: str, market_id: str | None, mode: str,
                    limit: int, group_keywords: bool, clickstream: bool, **_request: Any) -> dict[str, Any]:
    """POST /api/seo/keywords/research - keyword ideas for one seed in one market."""
    request = market_request(keyword, market_id)
    options = effective_options(request, mode, limit, group_keywords=group_keywords, clickstream=clickstream)
    cached = usable_research(RESEARCH_CACHE.get(research_cache_params(request, options)))
    payload = cached if cached is not None else fresh_research(request, options)
    return success_response({
        'keyword': request.keyword,
        'market_id': request.market_id,
        'location_code': request.codes.location_code,
        'language_code': request.codes.language_code,
        'data_source': request.codes.keyword_data,
        'source': payload.get('source'),
        'used_fallback': bool(payload.get('used_fallback')),
        'rows': payload.get('rows'),
        'cached': cached is not None,
        'fetched_at': payload.get('fetched_at'),
        'estimated_cost_usd': 0.0 if cached is not None else estimated_cost_usd(request, options),
    }, event)


# ---------------------------------------------------------------------------
# SERP
# ---------------------------------------------------------------------------

def serp_cache_params(request: MarketRequest) -> dict[str, Any]:
    """The SERP cache key parameters: keyword and market codes, never the depth."""
    codes = request.codes
    return {'keyword': request.keyword, 'location_code': codes.location_code, 'language_code': codes.language_code}


def item_json(item: OrganicItem) -> dict[str, Any]:
    """The API ``OrganicItem`` of one organic result."""
    return {
        'position': item.position,
        'rank_absolute': item.rank_absolute,
        'url': item.url,
        'domain': item.domain,
        'title': item.title,
        'description': item.description,
    }


def usable_snapshot(payload: object) -> Mapping[str, Any] | None:
    """A cached SERP snapshot of the current shape; anything else is a miss."""
    if not isinstance(payload, Mapping):
        return None
    shaped = (
        isinstance(payload.get('depth'), int) and isinstance(payload.get('items'), list)
        and isinstance(payload.get('item_types'), list) and isinstance(payload.get('fetched_at'), str)
    )
    return payload if shaped else None


def answers_depth(cached: Mapping[str, Any], depth: int) -> bool:
    """Whether ``cached`` serves a ``depth`` request: it is that deep, or a crawl that deep already came back empty."""
    checked = cached.get('checked_depth')
    return max(cached['depth'], checked if isinstance(checked, int) else 0) >= depth


def snapshot_payload(request: MarketRequest, depth: int, cached: Mapping[str, Any] | None) -> tuple[Mapping[str, Any], bool]:
    """``(payload, cached)``: the cached snapshot when it answers ``depth``, else a fresh crawl.

    An empty crawl never replaces cached results: the cached snapshot is answered instead and stored again with
    ``checked_depth``, so the next request at this depth is a hit rather than another paid crawl.
    """
    if cached is not None and answers_depth(cached, depth):
        return cached, True
    snapshot = organic_serp(request.keyword, request.codes, depth)
    payload = {
        'depth': depth,
        'items': [item_json(item) for item in snapshot.items],
        'item_types': list(snapshot.item_types),
        'check_url': snapshot.check_url,
        'fetched_at': get_timestamp(),
    }
    if not payload['items'] and cached is not None and cached['items']:
        logger.info('seo.serp.empty-deeper-crawl depth=%d cached_depth=%d', depth, cached['depth'])
        kept = {**cached, 'checked_depth': depth}
        SERP_CACHE.put(serp_cache_params(request), kept)
        return kept, True
    SERP_CACHE.put(serp_cache_params(request), payload)
    return payload, False


@json_object_body
@validate(SERP_SCHEMA)
def handle_serp(event: dict[str, Any], _context: Any, *, keyword: str, market_id: str | None, depth: int,
                **_request: Any) -> dict[str, Any]:
    """POST /api/seo/serp - the organic top ``depth`` of one keyword."""
    request = market_request(keyword, market_id)
    payload, hit = snapshot_payload(request, depth, usable_snapshot(SERP_CACHE.get(serp_cache_params(request))))
    item_types = payload['item_types']
    return success_response({
        'keyword': request.keyword,
        'market_id': request.market_id,
        'depth': payload['depth'],
        'items': payload['items'],
        'item_types': item_types,
        'has_ai_overview': AI_OVERVIEW_ITEM_TYPE in item_types,
        'check_url': payload.get('check_url'),
        'cached': hit,
        'fetched_at': payload['fetched_at'],
    }, event)


handler = seo_route({
    ('POST', '/research'): handle_research,
    ('POST', '/serp'): handle_serp,
})
