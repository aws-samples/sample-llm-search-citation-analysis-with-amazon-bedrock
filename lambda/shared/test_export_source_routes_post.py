"""``shared.export_source_routes`` replaying POST routes (JSON body), capped offset lists and the re-read flag."""

from __future__ import annotations

import json

from shared.export_source_routes import Paging, RouteList, RouteRequest, RouteSource, columns, route_event
from testing.export_source_fixtures import USER, PagedRoute, all_rows, numbered_items, resumed_from_every_row
from testing.seo_paid_export_fixtures import FakeSeoTable

_COLUMNS = columns('Keyword=keyword')
_WINDOWS = Paging('offset', request_param='offset', limit=4, more_key='has_more')
_POST_LIST = RouteList(
    'keywords', _COLUMNS, 'seo', '/api/seo/domains/keywords', 'items', _WINDOWS, method='POST',
    json_params=('filters',), max_rows_param='rows', reread_flag='cached_only', forwards=('target', 'filters'),
)


def _post_source(route: FakeSeoTable) -> RouteSource:
    return RouteSource('seo-domain', (_POST_LIST,), params=('target', 'filters', 'rows'), invoker=route)


def test_route_event_of_a_post_carries_its_method_and_json_body() -> None:
    event = route_event(RouteRequest('seo', '/api/seo/x', '/api/seo/x', {}, method='POST', body={'offset': 0, 'filters': {}}))

    assert (event['httpMethod'], json.loads(event['body']), event['queryStringParameters']) == (
        'POST', {'offset': 0, 'filters': {}}, None,
    )


def test_route_event_of_a_get_keeps_its_query_and_no_body() -> None:
    event = route_event(RouteRequest('stats-insights', '/api/items', '/api/items', {'limit': '3'}))

    assert (event['httpMethod'], event['body'], event['queryStringParameters']) == ('GET', None, {'limit': '3'})


def test_a_post_list_sends_its_params_json_decoded_and_its_window_as_numbers() -> None:
    route = FakeSeoTable(total=3)

    all_rows(_post_source(route), {'target': 'example.com', 'filters': '{"min_volume": 5}', 'rows': '3'})

    assert route.bodies == [{'target': 'example.com', 'filters': {'min_volume': 5}, 'offset': 0, 'limit': 3}]


def test_a_capped_list_asks_only_the_rest_in_its_last_window() -> None:
    route = FakeSeoTable(total=100)

    all_rows(_post_source(route), {'target': 'example.com', 'rows': '10'})

    assert [(body['offset'], body['limit']) for body in route.bodies] == [(0, 4), (4, 4), (8, 2)]


def test_a_capped_list_ends_at_its_cap() -> None:
    route = FakeSeoTable(total=100)

    rows = all_rows(_post_source(route), {'target': 'example.com', 'rows': '10'})

    assert [row.values[0] for row in rows] == [f'kw-{number}' for number in range(10)]


def test_an_offset_list_ends_when_the_answer_says_no_row_follows() -> None:
    route = FakeSeoTable(total=8)

    all_rows(_post_source(route), {'target': 'example.com', 'rows': '40'})

    assert [body['offset'] for body in route.bodies] == [0, 4]


def test_resuming_a_capped_post_list_after_any_row_yields_exactly_the_remaining_rows() -> None:
    route = FakeSeoTable(total=100)
    source = _post_source(route)
    params = {'target': 'example.com', 'rows': '10'}
    rows = all_rows(source, params)

    remaining = {index: [row.values for row in after] for index, after in resumed_from_every_row(source, params, rows)}

    assert remaining == {index: [row.values for row in rows[index + 1:]] for index in range(len(rows))}


def test_a_resumed_page_is_asked_with_the_re_read_flag_and_the_next_one_without() -> None:
    route = FakeSeoTable(total=100)
    source = _post_source(route)
    params = {'target': 'example.com', 'rows': '10'}
    cursor = json.loads(json.dumps(all_rows(source, params)[5].cursor))
    route.requests.clear()

    all_rows(source, params, cursor)

    assert [(body['offset'], body.get('cached_only')) for body in route.bodies] == [(4, True), (8, None)]


def test_a_get_list_with_a_re_read_flag_sends_it_as_true_on_resume() -> None:
    route = PagedRoute(numbered_items(6), by_offset=True)
    route_list = RouteList('Items', columns('name'), 'stats-insights', '/api/items', 'items',
                           Paging('offset', request_param='offset', limit=3), reread_flag='stored_only')
    source = RouteSource('sources', (route_list,), invoker=route)
    cursor = json.loads(json.dumps(all_rows(source, {})[1].cursor))
    route.requests.clear()

    all_rows(source, {}, cursor)

    assert [dict(request.query) for request in route.requests] == [
        {'limit': '3', 'stored_only': 'true'}, {'limit': '3', 'offset': '3'}, {'limit': '3', 'offset': '6'},
    ]


def test_a_get_list_without_a_re_read_flag_resumes_with_its_plain_query() -> None:
    route = PagedRoute(numbered_items(6), by_offset=True)
    route_list = RouteList('Items', columns('name'), 'stats-insights', '/api/items', 'items',
                           Paging('offset', request_param='offset', limit=3))
    source = RouteSource('sources', (route_list,), invoker=route)
    cursor = json.loads(json.dumps(all_rows(source, {})[1].cursor))
    route.requests.clear()

    all_rows(source, {}, cursor)

    assert [dict(request.query) for request in route.requests] == [
        {'limit': '3'}, {'limit': '3', 'offset': '3'}, {'limit': '3', 'offset': '6'},
    ]


def test_validate_refuses_a_json_param_that_holds_no_json() -> None:
    assert _post_source(FakeSeoTable(total=1)).validate({'target': 'example.com', 'filters': '{'}, USER) == 'filters must be JSON'
