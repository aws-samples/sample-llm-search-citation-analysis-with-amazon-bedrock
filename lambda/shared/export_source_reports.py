"""
Export sources of the report views: S21 group KPIs, S22 report insights.

``group-kpis`` writes the Group KPI report of the view's scope, market and
``days`` (``GET /api/reports/group-kpis``): every run of the window
(``view=runs``, oldest first), the keywords that drove each compared run
(``view=drivers``, one row per run and keyword) and every keyword's runs
(``view=keywords``, the drill-down, one row per keyword and run).

``report-insights`` writes the facts behind the Insights report, one sheet
per fact (``GET /api/reports/insights`` with the view's scope, market and
``days``): every owned page and every prompt-by-engine keyword
(``view=owned_pages`` / ``view=prompt_engine``, 2.45.0 wave 5), and the
facts the answer holds whole (engines, citation ownership per engine, owned
sections, competitor caveats and every caveat reason (``view=caveat_reasons``), portfolio, a group's stability).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from shared.export_source_routes import SINGLE, Column, Paging, RouteList, RouteSource, columns, kpi_columns
from shared.export_source_visibility import SCOPE_PARAMS, SCOPED_PARTIAL
from shared.kpi_engine import KPI_IDS

_ROUTER, _INSIGHTS = 'stats-insights', '/api/reports/insights'


def _fact(sheet: str, names: tuple[Column, ...], items: str) -> RouteList:
    return RouteList(sheet, names, _ROUTER, _INSIGHTS, items, SINGLE, partial_flags=SCOPED_PARTIAL)


REPORT_INSIGHTS = RouteSource(
    'report-insights',
    (
        RouteList(
            'Owned pages', columns('url', 'section', 'is_document', 'citations', 'engines'),
            _ROUTER, _INSIGHTS, 'facts.owned_pages.pages', Paging(response_key='facts.owned_pages.next_token', limit_param=None),
            {'view': 'owned_pages'}, partial_flags=SCOPED_PARTIAL,
        ),
        RouteList(
            'Prompts by engine', columns('keyword', 'visibility_score', 'positions', 'lost_engines'),
            _ROUTER, _INSIGHTS, 'facts.prompt_engine.keywords', Paging(response_key='facts.prompt_engine.next_token', limit_param=None),
            {'view': 'prompt_engine'}, partial_flags=SCOPED_PARTIAL,
        ),
        _fact('Engines', (*columns('engine', 'play'), *kpi_columns()), 'facts.engines'),
        _fact('Citation ownership', columns('engine', 'answers', 'citations', 'owned', 'third_party', 'competitors'), 'facts.citation_ownership.engines'),
        _fact('Owned sections', columns('section', 'citations', 'document_citations', 'pages'), 'facts.owned_pages.sections'),
        _fact('Competitor caveats', columns('name', 'mentions', 'mixed', 'negative', 'caveat_share', 'reasons_total'), 'facts.competitor_caveats'),
        RouteList(
            'Caveat reasons', columns('competitor', 'reason'),
            _ROUTER, _INSIGHTS, 'facts.caveat_reasons.reasons', Paging(response_key='facts.caveat_reasons.next_token', limit_param=None),
            {'view': 'caveat_reasons'}, partial_flags=SCOPED_PARTIAL,
        ),
        _fact(
            'Portfolio',
            columns('name', 'mentions', 'average_position', 'net_sentiment', 'citations', 'position_gap', 'sentiment_gap', 'weak'),
            'facts.portfolio',
        ),
        _fact('Stability', columns('keyword', 'runs', 'position_min', 'position_max', 'position_range', 'flips', 'unstable'), 'facts.stability'),
    ),
    params=(*SCOPE_PARAMS, 'days'),
)

_GROUP_KPIS = '/api/reports/group-kpis'


def _nested(key: str, parent: str) -> Any:
    """The rows of a list item's nested ``key`` list, each with the item's ``parent`` field (a run's drivers, a keyword's runs)."""
    def rows_of(item: Mapping[str, Any]) -> list[Mapping[str, Any]]:
        nested = item.get(key)
        rows = nested if isinstance(nested, list) else []
        return [{parent: item.get(parent), **row} for row in rows if isinstance(row, Mapping)]

    return rows_of


def _driver_rows(item: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [{'previous_timestamp': item.get('previous_timestamp'), **row} for row in _nested('drivers', 'timestamp')(item)]


_DELTAS = tuple(Column(f'change_{kpi}', f'deltas.{kpi}') for kpi in KPI_IDS)

GROUP_KPIS = RouteSource(
    'group-kpis',
    (
        RouteList(
            'Runs', (*columns('timestamp', 'is_group_run', 'keywords_with_data', 'keywords_total', 'coverage'), *kpi_columns()),
            _ROUTER, _GROUP_KPIS, 'runs', Paging(limit_param=None), {'view': 'runs'}, partial_flags=SCOPED_PARTIAL,
        ),
        RouteList(
            'Drivers',
            (*columns('timestamp', 'previous_timestamp', 'keyword', 'impact_mention_rate=impact.mention_rate',
                      'impact_visibility_score=impact.visibility_score'), *_DELTAS),
            _ROUTER, _GROUP_KPIS, 'changes', Paging(limit_param=None), {'view': 'drivers'}, partial_flags=SCOPED_PARTIAL,
            rows_of=_driver_rows,
        ),
        RouteList(
            'Keyword runs', (*columns('keyword', 'timestamp'), *kpi_columns(), Column('previous_timestamp', 'change.previous_timestamp')),
            _ROUTER, _GROUP_KPIS, 'keywords', Paging(limit=25), {'view': 'keywords'},
            partial_flags=SCOPED_PARTIAL, rows_of=_nested('runs', 'keyword'),
        ),
    ),
    params=(*SCOPE_PARAMS, 'days'),
)

SOURCES_OF_REPORTS: tuple[RouteSource, ...] = (GROUP_KPIS, REPORT_INSIGHTS)
