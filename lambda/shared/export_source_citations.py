"""
Export sources of the citation views: S12 citations, S13 URL breakdown, S14 crawl history, S15 searches.

Each reads the view's own route (router ``citations-content``) with its filters:

- ``citations``: every cited URL of the scope (``GET /api/citations``) in the
  view's sort and filters, with the keywords citing it
  (``include_keywords``); large scopes are served from the citation rollup,
  a live read cut by its caps says ``truncated`` and fails the export.
- ``url-breakdown``: every (keyword, engine) citing one URL, newest first
  (offset ``next_token``, ``market_id``; 2.45.0 wave 5).
- ``crawl-history``: every crawl of one URL, newest first
  (``GET /api/crawled-content?include_history=true``), without the page text.
- ``searches``: every stored answer row of Recent Searches / keyword detail
  (``GET /api/searches``, newest first across engines), without the answer.
"""

from __future__ import annotations

from shared.export_source_routes import Paging, RouteList, RouteSource, columns
from shared.export_source_visibility import SCOPE_PARAMS

_ROUTER = 'citations-content'

CITATIONS = RouteSource(
    'citations',
    (RouteList(
        'Citations', columns('url', 'citation_count', 'keyword_count', 'content_type', 'by_provider', 'keywords'),
        _ROUTER, '/api/citations', 'top_urls', Paging(limit=1000), {'include_keywords': 'true'},
    ),),
    params=(*SCOPE_PARAMS, 'sort', 'order', 'url_contains', 'min_citations', 'content_type'),
)

URL_BREAKDOWN = RouteSource(
    'url-breakdown',
    (RouteList(
        'Breakdown', columns('keyword', 'provider', 'timestamp'),
        _ROUTER, '/api/url-breakdown', 'breakdown', Paging(limit=1000), resume_key=('keyword', 'provider'),
    ),),
    params=('url', 'market_id'),
    required=('url',),
)

CRAWL_HISTORY = RouteSource(
    'crawl-history',
    (RouteList(
        'Crawls',
        columns(
            'crawled_at', 'normalized_url', 'keyword', 'status', 'title', 'summary', 'content_type', 'citation_count',
            'citing_providers', 'analysis_status', 'error_message', 'block_reason',
            'page_load_time_ms=metadata.page_load_time_ms', 'content_length=metadata.content_length',
        ),
        _ROUTER, '/api/crawled-content', 'items', Paging(limit=500),
        {'include_history': 'true', 'include_content': 'false', 'include_screenshot_url': 'false'}, partial_flags=(),
        resume_key=('normalized_url', 'crawled_at'),
    ),),
    params=('url',),
    required=('url',),
)

SEARCHES = RouteSource(
    'searches',
    (RouteList(
        'Searches',
        columns(
            'timestamp', 'keyword', 'provider', 'provider_type', 'query_prompt_id', 'query_prompt_name', 'market_id',
            'status', 'brand_count', 'citations', 'error',
        ),
        _ROUTER, '/api/searches', 'searches', Paging(limit=500), partial_flags=(), resume_key=('keyword', 'timestamp_provider'),
    ),),
    params=('keyword', 'keyword_contains', 'provider', 'query_prompt_id', 'market_id'),
)

SOURCES_OF_CITATIONS: tuple[RouteSource, ...] = (CITATIONS, URL_BREAKDOWN, CRAWL_HISTORY, SEARCHES)
