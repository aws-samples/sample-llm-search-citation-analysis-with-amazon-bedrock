"""
Export sources of the mention views: S1 brand appearances, S3 brand mention summary, S10 persona rankings, S11 sentiment examples.

Each reads the view's own route with its scope, market and filters:

- ``brand-appearances``: every appearance of the Brands view / brand
  drill-down (``GET /api/brand-mentions?view=appearances``, keyword-major,
  ``next_token``), one row per brand mention, the columns of the 2.44
  appearances file. The route pages a large scope from its snapshot or a
  view job, so no ranking pass is redone per export chunk.
- ``brand-mention-summary``: every brand of the summary, best aggregate
  score first (``view=brands`` from the top, ``aggregated.next_token``;
  2.45.0 wave 5 lifted the 100-brand cap of the summary).
- ``sentiment-examples``: every example of one sentiment
  (``GET /api/visibility/sentiment-examples``, keyword-major pages).
- ``persona-rankings``: one keyword's brands per persona and the
  cross-persona summary (one answer, two sheets).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from shared.export_source_routes import SINGLE, Column, Paging, RouteList, RouteSource, columns
from shared.export_source_visibility import SCOPE_PARAMS, SCOPED_PARTIAL

_ROUTER, _PATH = 'brand-mentions', '/api/brand-mentions'
#: The Brands view's filters (``web/src/api/brandMentions.ts``) besides its scope and market.
MENTION_PARAMS: tuple[str, ...] = (*SCOPE_PARAMS, 'timestamp', 'provider', 'classification', 'query_prompt_id')
#: A mention page the time budget cut (keywords or the answers of a page) is partial.
_MENTION_PARTIAL = (*SCOPED_PARTIAL, 'truncated')

APPEARANCE_COLUMNS = columns(
    'brand', 'classification', 'overall_rank', 'keyword', 'provider', 'model', 'query_prompt_id', 'rank',
    'mention_count', 'first_position', 'sentiment', 'sentiment_reason', 'sentiment_quote', 'ranking_context',
)

BRAND_APPEARANCES = RouteSource(
    'brand-appearances',
    (RouteList(
        'Appearances', APPEARANCE_COLUMNS, _ROUTER, _PATH, 'appearances', Paging(limit=2000), {'view': 'appearances'},
        partial_flags=_MENTION_PARTIAL,
    ),),
    params=(*MENTION_PARAMS, 'brand'),
)

_SENTIMENTS = ('positive', 'neutral', 'negative', 'mixed')

BRAND_SUMMARY_COLUMNS = (
    *columns(
        'overall_rank', 'name', 'parent_company', 'classification', 'aggregate_score', 'total_mentions', 'appearance_count',
        'keyword_count', 'best_rank', 'provider_count', 'providers', 'provider_ranks',
    ),
    *(Column(f'sentiment_{label}', f'sentiment_counts.{label}') for label in _SENTIMENTS),
)

BRAND_MENTION_SUMMARY = RouteSource(
    'brand-mention-summary',
    (RouteList(
        'Brands', BRAND_SUMMARY_COLUMNS, _ROUTER, _PATH, 'aggregated.brands',
        Paging(response_key='aggregated.next_token', limit_param=None), {'view': 'brands'}, partial_flags=_MENTION_PARTIAL,
    ),),
    params=MENTION_PARAMS,
)

SENTIMENT_EXAMPLES = RouteSource(
    'sentiment-examples',
    (RouteList(
        'Examples',
        columns(
            'keyword', 'provider', 'persona', 'persona_name', 'timestamp', 'brand', 'rank', 'sentiment',
            'quote', 'reason', 'ranking_context', 'answer', 'answer_truncated',
        ),
        'stats-insights', '/api/visibility/sentiment-examples', 'examples', Paging(limit=50), partial_flags=_MENTION_PARTIAL,
    ),),
    params=(*SCOPE_PARAMS, 'sentiment', 'provider', 'classification'),
    required=('sentiment',),
)


def _persona_brands(persona: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """One row per brand of a persona, tagged with the persona."""
    brands = persona.get('brands')
    tag = {'persona_id': persona.get('persona_id'), 'persona_name': persona.get('persona_name')}
    return [{**tag, **brand} for brand in brands if isinstance(brand, Mapping)] if isinstance(brands, list) else []


_PERSONA_ROUTER, _PERSONA_PATH = 'persona-rankings', '/api/persona-rankings'

PERSONA_RANKINGS = RouteSource(
    'persona-rankings',
    (
        RouteList(
            'Personas', columns('persona_id', 'persona_name', 'name', 'classification', 'rank', 'mention_count', 'sentiment', 'visibility_score'),
            _PERSONA_ROUTER, _PERSONA_PATH, 'personas', SINGLE, partial_flags=(), rows_of=_persona_brands,
        ),
        RouteList(
            'Across personas', columns('name', 'classification', 'avg_rank', 'best_rank', 'worst_rank', 'best_persona'),
            _PERSONA_ROUTER, _PERSONA_PATH, 'cross_persona_summary.brands', SINGLE, partial_flags=(),
        ),
    ),
    params=('keyword', 'query_prompt_id'),
    required=('keyword',),
)

SOURCES_OF_MENTIONS: tuple[RouteSource, ...] = (BRAND_APPEARANCES, BRAND_MENTION_SUMMARY, SENTIMENT_EXAMPLES, PERSONA_RANKINGS)
