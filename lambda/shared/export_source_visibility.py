"""
Export sources of the Visibility views (``GET /api/visibility``): S2 brand leaderboard, S5 sources, S6 keyword visibility, S9 engines.

Every one reads the view's own route with its scope (``keyword`` /
``group_id`` / ``keyword_ids`` / ``scope=all``, ``market_id``) and filters:
``view=brands`` and ``view=sources`` page the whole leaderboard and source
table (2.45.0 wave 5), ``view=keywords`` every keyword row; the summary
body holds the headline KPIs and the engines.
"""

from __future__ import annotations

from shared.export_source_routes import SINGLE, Paging, RouteList, RouteSource, columns, kpi_columns
from shared.scope_params import SCOPE_QUERY_PARAMS

#: The scope parameters of every scoped view (and the market filter).
SCOPE_PARAMS: tuple[str, ...] = tuple(SCOPE_QUERY_PARAMS)
#: A scoped page whose keywords the time budget cut is partial.
SCOPED_PARTIAL = ('keywords_truncated',)

_ROUTER, _PATH = 'stats-insights', '/api/visibility'
_PARAMS = (*SCOPE_PARAMS, 'query_prompt_id')
_PAGED = Paging(limit_param=None)

BRAND_COLUMNS = (
    *columns(
        'position', 'name', 'classification', 'mentions', 'mention_rate', 'share_of_voice', 'average_position',
        'best_position', 'visibility_score', 'engines', 'keywords', 'net_sentiment',
    ),
    *columns(*(f'sentiment_{label}=sentiment_split.{label}' for label in ('positive', 'neutral', 'negative', 'mixed'))),
)

BRAND_LEADERBOARD = RouteSource(
    'brand-leaderboard',
    (RouteList('Brands', BRAND_COLUMNS, _ROUTER, _PATH, 'brands', _PAGED, {'view': 'brands'}, partial_flags=SCOPED_PARTIAL),),
    params=(*_PARAMS, 'brand'),
)

SOURCES = RouteSource(
    'sources',
    (RouteList(
        'Sources', columns('domain', 'owned', 'citations', 'citation_rate', 'citation_share', 'engines', 'keywords'),
        _ROUTER, _PATH, 'sources', _PAGED, {'view': 'sources'}, partial_flags=SCOPED_PARTIAL,
    ),),
    params=_PARAMS,
)

KEYWORD_VISIBILITY = RouteSource(
    'keyword-visibility',
    (
        RouteList('Summary', kpi_columns(''), _ROUTER, _PATH, 'kpis', SINGLE, partial_flags=SCOPED_PARTIAL),
        RouteList(
            'Keywords', (*columns('keyword', 'timestamp', 'has_data'), *kpi_columns()),
            _ROUTER, _PATH, 'keywords', _PAGED, {'view': 'keywords'}, partial_flags=SCOPED_PARTIAL,
        ),
    ),
    params=_PARAMS,
)

ENGINES = RouteSource(
    'engines',
    (RouteList('Engines', (*columns('engine'), *kpi_columns()), _ROUTER, _PATH, 'engines', SINGLE, partial_flags=SCOPED_PARTIAL),),
    params=_PARAMS,
)

SOURCES_OF_VISIBILITY: tuple[RouteSource, ...] = (BRAND_LEADERBOARD, SOURCES, KEYWORD_VISIBILITY, ENGINES)
