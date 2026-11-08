"""Export sources S25 keyword research, S26 alerts, S27 configuration lists, against fake routes.

The routes are the dashboard's own (their paging is tested with their
handlers); here: which route and parameters each list reads, how a job's
rows flatten, the on-screen ``intent`` filter, which lists a parameter
selects, and that the users list is an Admin's.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

import pytest

from shared.export_source_lists import ALERTS, CONFIG_LISTS, KEYWORD_RESEARCH
from shared.export_source_routes import ExportSourceError, RouteRequest, RouteSource
from testing.export_source_fixtures import ADMIN, USER, PagedRoute, all_rows, resumed_from_every_row, row_values

_JOB = {
    'id': 'job-1',
    'type': 'agent',
    'keywords': [
        {'keyword': 'hotel coruña', 'intent': 'transactional', 'competition': 'high', 'relevance': 9},
        {'keyword': 'qué ver en coruña', 'intent': 'informational', 'competition': 'low', 'relevance': 7},
        {'keyword': 'hotel barato coruña', 'intent': 'transactional', 'competition': 'medium', 'relevance': 8},
    ],
    'analysis': {'primary_keywords': [{'keyword': 'hotel mar'}], 'content_gaps': [{'keyword': 'parking'}, {'keyword': 'spa'}]},
    'rounds': [
        {'round': 1, 'strategy': 'broad', 'queries': [{'query': 'q1', 'dimension': 'intent'}], 'evaluation': {'decision': 'continue'}},
        {'round': 2, 'strategy': 'narrow', 'queries': [{'query': 'q2'}, {'query': 'q3'}]},
    ],
}


@dataclass
class Routes:
    """A fake router: a fixed body per path, recording each request."""

    bodies: dict[str, Any]
    requests: list[RouteRequest] = field(default_factory=list)

    def __call__(self, request: RouteRequest) -> tuple[int, Any]:
        self.requests.append(request)
        return 200, self.bodies[request.path]


def _over(source: RouteSource, invoker: Any) -> RouteSource:
    return replace(source, invoker=invoker, sleep=lambda _seconds: None)


def _job_rows(params: dict[str, str]) -> list[tuple[str, tuple[Any, ...]]]:
    return row_values(all_rows(_over(KEYWORD_RESEARCH, Routes({'/api/keyword-research/job-1': _JOB})), params))


def test_a_job_export_reads_the_job_by_its_id_as_a_path_parameter():
    routes = Routes({'/api/keyword-research/job-1': _JOB})
    all_rows(_over(KEYWORD_RESEARCH, routes), {'id': 'job-1'})

    assert [(request.path, request.resource, dict(request.path_params or {}), dict(request.query)) for request in routes.requests] == [
        ('/api/keyword-research/job-1', '/api/keyword-research/{id}', {'id': 'job-1'}, {}),
    ] * 3


def test_a_job_export_lists_its_keywords_then_competitor_keywords_then_agent_queries():
    sheets = [sheet for sheet, _values in _job_rows({'id': 'job-1'})]

    assert sheets == ['Keywords'] * 3 + ['Competitor keywords'] * 3 + ['Agent queries'] * 3


def test_the_intent_filter_keeps_only_the_keywords_of_that_intent():
    keywords = [values[0] for sheet, values in _job_rows({'id': 'job-1', 'intent': 'transactional'}) if sheet == 'Keywords']

    assert keywords == ['hotel coruña', 'hotel barato coruña']


def test_competitor_keywords_carry_their_category_in_the_views_order():
    rows = [values[:2] for sheet, values in _job_rows({'id': 'job-1'}) if sheet == 'Competitor keywords']

    assert rows == [('primary_keywords', 'hotel mar'), ('content_gaps', 'parking'), ('content_gaps', 'spa')]


def test_agent_queries_carry_their_round_strategy_and_decision():
    rows = [values[:3] + values[5:6] for sheet, values in _job_rows({'id': 'job-1'}) if sheet == 'Agent queries']

    assert rows == [(1, 'broad', 'q1', 'continue'), (2, 'narrow', 'q2', None), (2, 'narrow', 'q3', None)]


def test_without_an_id_the_export_is_every_job_of_the_history_of_that_type():
    route = PagedRoute([{'id': f'job-{index:03}', 'type': 'agent'} for index in range(250)])
    rows = all_rows(_over(KEYWORD_RESEARCH, route), {'type': 'agent'})

    assert ({row.sheet for row in rows}, len(rows), route.requests[0].path, route.requests[0].query['type']) == (
        {'History'}, 250, '/api/keyword-research/history', 'agent',
    )


def test_alerts_follow_every_page_of_the_status():
    route = PagedRoute([{'id': f'a{index:03}', 'status': 'open'} for index in range(230)])
    rows = all_rows(_over(ALERTS, route), {'status': 'all'})

    assert (len(rows), {request.query['status'] for request in route.requests}, route.requests[0].path) == (230, {'all'}, '/api/alerts')


def test_a_group_id_exports_that_groups_content_changes_instead():
    route = PagedRoute([{'id': f'c{index}', 'group_id': 'g1'} for index in range(3)])
    rows = all_rows(_over(ALERTS, route), {'group_id': 'g1'})

    assert ([row.sheet for row in rows], route.requests[0].path, dict(route.requests[0].query)) == (
        ['Content changes'] * 3, '/api/alerts/content-changes', {'group_id': 'g1', 'limit': '100'},
    )


def test_alerts_resume_after_every_row_with_exactly_the_remaining_rows():
    source = _over(ALERTS, PagedRoute([{'id': f'a{index:03}'} for index in range(205)]))
    rows = all_rows(source, {})

    resumed = {index: row_values(rest) for index, rest in resumed_from_every_row(source, {}, rows)}

    assert resumed == {index: row_values(rows[index + 1:]) for index in range(len(rows))}


@pytest.mark.parametrize(('name', 'path'), [
    ('keywords', '/api/keywords'),
    ('keyword_groups', '/api/keyword-groups'),
    ('markets', '/api/markets'),
    ('personas', '/api/query-prompts'),
    ('schedules', '/api/schedules'),
    ('users', '/api/users'),
])
def test_each_config_list_reads_its_settings_route(name, path):
    routes = Routes({path: {'keywords': [], 'groups': [], 'markets': [], 'schedules': [], 'users': [], 'next_token': None} if name != 'personas' else []})
    all_rows(_over(CONFIG_LISTS, routes), {'list': name})

    assert [request.path for request in routes.requests] == [path]


def test_a_settings_answer_without_its_list_fails_the_export():
    routes = Routes({'/api/schedules': {'items': [], 'next_token': None}})

    with pytest.raises(ExportSourceError, match='answered without its list schedules'):
        all_rows(_over(CONFIG_LISTS, routes), {'list': 'schedules'})


def test_a_paged_answer_without_its_next_token_key_fails_the_export():
    routes = Routes({'/api/schedules': {'schedules': [{'id': 's1'}]}})

    with pytest.raises(ExportSourceError, match='has no next_token to page by'):
        all_rows(_over(CONFIG_LISTS, routes), {'list': 'schedules'})


def test_personas_are_the_list_the_route_answers_as_its_body():
    routes = Routes({'/api/query-prompts': [{'id': 'p1', 'name': 'Familia'}, {'id': 'p2', 'name': 'Negocios'}]})

    assert [row.values[:2] for row in all_rows(_over(CONFIG_LISTS, routes), {'list': 'personas'})] == [('p1', 'Familia'), ('p2', 'Negocios')]


def test_keywords_follow_every_scan_page():
    route = PagedRoute([{'id': f'k{index:04}', 'keyword': f'kw {index}'} for index in range(2_500)], list_key='keywords')

    assert len(all_rows(_over(CONFIG_LISTS, route), {'list': 'keywords'})) == 2_500


def test_the_users_list_is_read_as_an_admin():
    route = PagedRoute([{'username': 'ana'}], list_key='users')
    all_rows(_over(CONFIG_LISTS, route), {'list': 'users'})

    assert route.requests[0].admin is True


def test_only_an_admin_may_export_the_users():
    assert (CONFIG_LISTS.validate({'list': 'users'}, USER), CONFIG_LISTS.validate({'list': 'users'}, ADMIN)) == (
        'Only an Admin may export this list', None,
    )


def test_a_config_export_needs_a_known_list():
    assert CONFIG_LISTS.validate({'list': 'secrets'}, ADMIN) == 'list must be one of: keywords, keyword_groups, markets, personas, schedules, users'


def test_a_config_export_needs_the_list_parameter():
    assert CONFIG_LISTS.validate({}, ADMIN) == 'The config-lists export needs: list'
