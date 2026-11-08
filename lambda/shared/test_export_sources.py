"""The export source registry: one source per export view, named as its view, with well-formed sheets."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

import pytest

from shared.export_contract import EXPORT_VIEWS
from shared.export_source_routes import RouteList, RouteSource, job_failed, path_value
from shared.export_sources import EXPORT_SOURCES

_REGISTERED = sorted(EXPORT_SOURCES)


def test_the_registered_sources_are_exactly_the_export_views() -> None:
    assert set(EXPORT_SOURCES) == set(EXPORT_VIEWS)


@pytest.mark.parametrize('view', _REGISTERED)
def test_each_source_is_registered_under_its_own_view(view: str) -> None:
    assert EXPORT_SOURCES[view].view == view


@pytest.mark.parametrize('view', _REGISTERED)
def test_each_source_has_sheets_with_distinct_names_and_columns(view: str) -> None:
    sheets = EXPORT_SOURCES[view].sheets
    problems = [sheet.name for sheet in sheets if not sheet.columns or len(set(sheet.columns)) != len(sheet.columns)]

    assert (len({sheet.name for sheet in sheets}), problems) == (len(sheets), [])


# --- Every list key exists in its route's real answers (review F4) ------------------------

_FIXTURES = Path(__file__).resolve().parents[2] / 'test-fixtures' / 'scope-snapshots'
_ROUTE_ANSWERS = [
    (path.stem, case_name, document['route'], case)
    for path in sorted(_FIXTURES.glob('*.json'))
    for document in (json.loads(path.read_text(encoding='utf-8')),)
    for case_name, case in document['cases'].items()
    if case['status'] == 200 and not job_failed(case['body'])
]


def _answering_lists(route: str, query: dict[str, str]) -> list[tuple[str, RouteList]]:
    """``(view, list)`` of every export list of the fixture's route and ``view`` (other fixed params narrow rows, not the shape)."""
    path, _, fixed_query = route.removeprefix('GET ').partition('?')
    asked = {**dict(parse_qsl(fixed_query, keep_blank_values=True)), **query}
    return [
        (view, route_list) for view, source in sorted(EXPORT_SOURCES.items()) if isinstance(source, RouteSource)
        for route_list in source.lists
        if route_list.path == path and asked.get('view') == route_list.fixed.get('view')
    ]


_LISTS_OF_ANSWERS = [
    pytest.param(case, view, route_list, id=f'{fixture}-{case_name}-{view}-{route_list.sheet}')
    for fixture, case_name, route, case in _ROUTE_ANSWERS
    for view, route_list in _answering_lists(route, case.get('query') or {})
]


#: Route fixtures no export list reads, and why.
_SUMMARY_ROUTES = {
    'reports-overview': 'the Executive Summary shows top-N counts; its See all views export through S8 and S19',
    'stats-market': 'a dashboard summary card; its full lists export through their own views',
}


def test_every_route_fixture_but_the_summaries_answers_some_export_list() -> None:
    answered = {fixture for fixture, _case_name, route, case in _ROUTE_ANSWERS if _answering_lists(route, case.get('query') or {})}

    assert sorted({fixture for fixture, *_rest in _ROUTE_ANSWERS} - answered) == sorted(_SUMMARY_ROUTES)


@pytest.mark.parametrize(('case', 'view', 'route_list'), _LISTS_OF_ANSWERS)
def test_each_list_key_is_in_its_routes_real_answer(case: dict[str, Any], view: str, route_list: RouteList) -> None:
    del view
    assert route_list.optional or path_value(case['body'], route_list.items) is not None


@pytest.mark.parametrize(('case', 'view', 'route_list'), _LISTS_OF_ANSWERS)
def test_each_paged_list_finds_its_next_token_key_in_its_routes_real_answer(case: dict[str, Any], view: str, route_list: RouteList) -> None:
    del view
    paging = route_list.paging
    key_parent, _, key = paging.response_key.rpartition('.')
    parent = path_value(case['body'], key_parent) if key_parent else case['body']

    assert paging.kind != 'token' or (isinstance(parent, dict) and key in parent)
