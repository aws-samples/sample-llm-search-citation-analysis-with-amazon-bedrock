"""
Export sources of the action views: S17 gap keyword summaries, S18 prompt insights, S19 recommendations.

Each reads the view's own route with its scope and market:

- ``prompt-insights``: one sheet per list (winning, losing, opportunities),
  each paged over its whole ranking with ``type=<tab>`` and
  ``<list>_next_token`` (2.45.0 wave 5).
- ``recommendations``: every rule recommendation with its saved status
  (``next_token``); never ``use_llm`` (an export does not call Bedrock).
- ``gap-keyword-summaries``: every keyword's gap summary
  (``keyword_summaries_next_token``).
- ``competitor-gap``: one competitor's outranked keywords and every
  exclusive source (``view=outreach``), two sheets.
- ``citation-gaps``: every gap of the scope ranked (``view=gaps``; one
  keyword: every gap of its whole latest run), crawl-enriched; a list some
  keyword's stored findings cut (``gaps_truncated``) fails the export.
"""

from __future__ import annotations

from shared.export_source_routes import Column, Paging, RouteList, RouteSource, columns
from shared.export_source_visibility import SCOPE_PARAMS, SCOPED_PARTIAL
from shared.prompt_classification import TYPE_LISTS

_ROUTER = 'stats-insights'

_SIDES = ('mentions', 'best_rank', 'provider_coverage', 'providers')
PROMPT_COLUMNS = (
    *columns('keyword', 'timestamp', 'status', 'score', 'improvement_potential', 'opportunity_score', 'total_providers'),
    *(Column(f'first_party_{field}', f'first_party.{field}') for field in _SIDES),
    *(Column(f'competitors_{field}', f'competitors.{field}') for field in _SIDES),
)
_SHEETS = {'winning': 'Winning', 'losing': 'Losing', 'opportunities': 'Opportunities'}


def _prompt_list(tab: str) -> RouteList:
    key = TYPE_LISTS[tab]
    return RouteList(
        _SHEETS[tab], PROMPT_COLUMNS, _ROUTER, '/api/prompt-insights', key,
        Paging(response_key=f'{key}_next_token'), {'type': tab}, partial_flags=SCOPED_PARTIAL,
    )


PROMPT_INSIGHTS = RouteSource('prompt-insights', tuple(_prompt_list(tab) for tab in _SHEETS), params=SCOPE_PARAMS)

RECOMMENDATIONS = RouteSource(
    'recommendations',
    (RouteList(
        'Recommendations',
        columns('id', 'priority', 'type', 'status', 'title', 'description', 'action', 'impact', 'keyword', 'keywords', 'competitor'),
        _ROUTER, '/api/recommendations', 'recommendations', Paging(limit=200), partial_flags=SCOPED_PARTIAL,
    ),),
    params=SCOPE_PARAMS,
)

GAP_KEYWORD_SUMMARIES = RouteSource(
    'gap-keyword-summaries',
    (RouteList(
        'Keywords', columns('keyword', 'gap_count', 'high_priority_gaps', 'coverage_rate'),
        _ROUTER, '/api/citation-gaps', 'keyword_summaries', Paging(response_key='keyword_summaries_next_token'),
        # A one-keyword scope answers that keyword's gaps and no summaries.
        partial_flags=SCOPED_PARTIAL, optional=True,
    ),),
    params=SCOPE_PARAMS,
)

GAP_COLUMNS = columns(
    'keyword', 'url', 'domain', 'content_type', 'priority', 'citation_count', 'providers', 'provider_count',
    'first_party_brands', 'competitor_brands', 'title', 'domain_authority', 'last_crawled',
)

CITATION_GAPS = RouteSource(
    'citation-gaps',
    (RouteList(
        'Gaps', GAP_COLUMNS, _ROUTER, '/api/citation-gaps', 'gaps', Paging(limit_param=None), {'view': 'gaps'},
        partial_flags=(*SCOPED_PARTIAL, 'gaps_truncated'),
    ),),
    params=SCOPE_PARAMS,
)

_COMPETITOR_PATH = '/api/reports/competitor'

COMPETITOR_GAP = RouteSource(
    'competitor-gap',
    (
        RouteList(
            'Outranked keywords', columns('keyword', 'their_best_rank', 'our_best_rank', 'rank_delta', 'providers'),
            _ROUTER, _COMPETITOR_PATH, 'rollup.outranked_keywords', Paging(), partial_flags=SCOPED_PARTIAL,
        ),
        RouteList(
            'Exclusive sources', columns('url', 'domain', 'keyword', 'priority', 'lift_score', 'citation_count', 'provider_count', 'providers'),
            _ROUTER, _COMPETITOR_PATH, 'rollup.outreach_targets', Paging(response_key='rollup.next_token', limit_param=None),
            {'view': 'outreach'}, partial_flags=SCOPED_PARTIAL,
        ),
    ),
    params=(*SCOPE_PARAMS, 'competitor'),
    required=('competitor',),
)

SOURCES_OF_ACTIONS: tuple[RouteSource, ...] = (PROMPT_INSIGHTS, RECOMMENDATIONS, GAP_KEYWORD_SUMMARIES, CITATION_GAPS, COMPETITOR_GAP)
