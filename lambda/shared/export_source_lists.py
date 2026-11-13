"""
Export sources of the list views: S25 keyword research, S26 alerts, S27 configuration lists.

- ``keyword-research``: with ``id``, one research job's rows (``GET
  /api/keyword-research/{id}``): its keywords (expansion and agent
  proposal; ``intent`` narrows them as the results table does), a competitor
  analysis' keywords by category, and an agent's planned queries per round.
  Without ``id``, every job of the history newest first (``type`` filters
  it; ``GET /api/keyword-research/history``).
- ``alerts``: every KPI alert of ``status`` newest first (``GET
  /api/alerts``); with ``group_id``, that group's content-change markers
  instead (``GET /api/alerts/content-changes``).
- ``config-lists``: one Settings list chosen by ``list``: ``keywords``,
  ``keyword_groups``, ``markets``, ``personas``, ``schedules`` or ``users``
  (Admin only: ``validate`` refuses anyone else, and the users route is read
  as an Admin).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from shared.export_source_routes import SINGLE, Column, Paging, RouteList, RouteSource, columns

_RESEARCH_ROUTER = 'keyword-mgmt'
_JOB_PATH = '/api/keyword-research/{id}'
_COMPETITOR_CATEGORIES = ('primary_keywords', 'secondary_keywords', 'longtail_keywords', 'content_gaps')

KEYWORD_COLUMNS = columns(
    'keyword', 'intent', 'competition', 'relevance', 'opportunity', 'providers', 'dimension', 'rationale',
    'tracking', 'tracking_score', 'tracking_reason', 'source',
)


def _competitor_keywords(analysis: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Every keyword of a competitor analysis, tagged with its category, in the view's category order."""
    rows: list[Mapping[str, Any]] = []
    for category in _COMPETITOR_CATEGORIES:
        entries = analysis.get(category)
        if isinstance(entries, list):
            rows.extend({'category': category, **entry} for entry in entries if isinstance(entry, Mapping))
    return rows


def _round_queries(round_entry: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """An agent round's planned queries, tagged with the round, its strategy and its evaluation."""
    queries = round_entry.get('queries')
    stated = round_entry.get('evaluation')
    evaluation: Mapping[str, Any] = stated if isinstance(stated, Mapping) else {}
    tag = {
        'round': round_entry.get('round'), 'strategy': round_entry.get('strategy'),
        'decision': evaluation.get('decision'), 'assessment': evaluation.get('assessment'),
    }
    return [{**tag, **query} for query in queries if isinstance(query, Mapping)] if isinstance(queries, list) else []


def _job_list(sheet: str, column_names: tuple[Column, ...], items: str, **options: Any) -> RouteList:
    # A job answers only the lists of its type: an agent's keywords and rounds,
    # an expansion's keywords, a competitor analysis' analysis. The others are
    # absent, which reads as an empty sheet, not a failed export.
    return RouteList(
        sheet, column_names, _RESEARCH_ROUTER, _JOB_PATH, items, SINGLE,
        path_param='id', partial_flags=(), forwards=(), only_with='id', optional=True, **options,
    )


KEYWORD_RESEARCH = RouteSource(
    'keyword-research',
    (
        _job_list('Keywords', KEYWORD_COLUMNS, 'keywords', matches={'intent': 'intent'}),
        _job_list('Competitor keywords', (*columns('category'), *KEYWORD_COLUMNS), 'analysis', rows_of=_competitor_keywords),
        _job_list('Agent queries', columns('round', 'strategy', 'query', 'dimension', 'rationale', 'decision', 'assessment'), 'rounds', rows_of=_round_queries),
        RouteList(
            'History',
            columns(
                'id', 'type', 'status', 'seed_keyword', 'url', 'domain', 'industry', 'keyword_count', 'provider',
                'template_name', 'candidates_count', 'tracking_count', 'created_by', 'created_at', 'finished_at', 'error_message',
            ),
            _RESEARCH_ROUTER, '/api/keyword-research/history', 'items', Paging(limit=100),
            partial_flags=(), forwards=('type',), only_without='id', resume_key=('id',),
        ),
    ),
    params=('id', 'intent', 'type'),
)

_ALERTS_ROUTER = 'config-mgmt'

ALERTS = RouteSource(
    'alerts',
    (
        RouteList(
            'Alerts',
            columns(
                'id', 'created_at', 'run_timestamp', 'group_id', 'group_name', 'market_id', 'type', 'severity', 'status',
                'entity', 'previous', 'current', 'delta', 'threshold', 'message', 'execution_id',
            ),
            _ALERTS_ROUTER, '/api/alerts', 'items', Paging(), partial_flags=(), forwards=('status',), only_without='group_id',
            resume_key=('id',),
        ),
        RouteList(
            'Content changes', columns('id', 'group_id', 'changed_at', 'description', 'url'),
            _ALERTS_ROUTER, '/api/alerts/content-changes', 'items', Paging(), partial_flags=(), forwards=('group_id',), only_with='group_id',
            resume_key=('id',),
        ),
    ),
    params=('status', 'group_id'),
)

CONFIG_LISTS = RouteSource(
    'config-lists',
    (
        RouteList(
            'keywords', columns('id', 'keyword', 'status', 'market_id', 'group_ids', 'concept_id', 'priority', 'created_at'),
            'keyword-mgmt', '/api/keywords', 'keywords', Paging(limit=1000), partial_flags=(), forwards=(),
        ),
        RouteList(
            'keyword_groups', columns('id', 'name', 'description', 'keyword_count', 'created_at', 'updated_at'),
            'keyword-mgmt', '/api/keyword-groups', 'groups', SINGLE, partial_flags=(), forwards=(),
        ),
        RouteList(
            'markets',
            columns(
                'market_id', 'name', 'country', 'country_name', 'language', 'language_name', 'currency', 'timezone',
                'city', 'region', 'lat', 'lng', 'competitors',
            ),
            'config-mgmt', '/api/markets', 'markets', SINGLE, partial_flags=(), forwards=(),
        ),
        RouteList(
            'personas', columns('id', 'name', 'description', 'template', 'enabled', 'created_at', 'updated_at'),
            'config-mgmt', '/api/query-prompts', '', SINGLE, partial_flags=(), forwards=(),
        ),
        RouteList(
            'schedules', columns('id', 'display_name', 'enabled', 'schedule', 'timezone', 'legacy', 'form', 'scope', 'keywords'),
            'config-mgmt', '/api/schedules', 'schedules', Paging(), partial_flags=(), forwards=(),
        ),
        RouteList(
            'users', columns('username', 'email', 'email_verified', 'status', 'enabled', 'groups', 'created_at', 'updated_at'),
            'users', '/api/users', 'users', Paging(limit=60), partial_flags=(), forwards=(), admin=True,
        ),
    ),
    select='list',
    required=('list',),
)

SOURCES_OF_LISTS: tuple[RouteSource, ...] = (KEYWORD_RESEARCH, ALERTS, CONFIG_LISTS)
