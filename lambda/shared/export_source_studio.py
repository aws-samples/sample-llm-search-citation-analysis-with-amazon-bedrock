"""
Export sources of Content Studio: S23 content ideas, S24 content history.

- ``content-ideas``: every idea of the view's scope and market
  (``GET /api/content-studio/ideas``, paged by ``ideas_next_token``, 2.45.0 wave 5).
- ``content-history``: every generated piece, newest first
  (``GET /api/content-studio/history``, the merged status pages).
"""

from __future__ import annotations

from shared.export_source_routes import Paging, RouteList, RouteSource, columns
from shared.export_source_visibility import SCOPE_PARAMS, SCOPED_PARTIAL

_ROUTER = 'content-studio'

CONTENT_IDEAS = RouteSource(
    'content-ideas',
    (RouteList(
        'Ideas',
        columns(
            'id', 'priority', 'type', 'title', 'description', 'keyword', 'source', 'content_angle', 'current_rank',
            'competitor_brands', 'competitor_urls', 'providers_present', 'providers_missing', 'actionable',
        ),
        _ROUTER, '/api/content-studio/ideas', 'ideas', Paging(response_key='ideas_next_token'), partial_flags=SCOPED_PARTIAL,
    ),),
    params=SCOPE_PARAMS,
)

CONTENT_HISTORY = RouteSource(
    'content-history',
    (RouteList(
        'History',
        columns(
            'id', 'status', 'idea_title', 'keyword', 'idea_type', 'content_angle', 'model', 'viewed',
            'created_at', 'updated_at', 'batch_id', 'error_message',
        ),
        _ROUTER, '/api/content-studio/history', 'history', Paging(), partial_flags=(), resume_key=('id',),
    ),),
)

SOURCES_OF_STUDIO: tuple[RouteSource, ...] = (CONTENT_IDEAS, CONTENT_HISTORY)
