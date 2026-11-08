"""The route-replay export sources: complete lists, exact resume, no partial file."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import replace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from shared.export_contract import ExportMark, ExportRow, RowsEnd
from shared.export_source_routes import (
    INVOKE_START_SECONDS,
    ROUTER_READ_SECONDS,
    SINGLE,
    ExportSourceError,
    Paging,
    RouteList,
    RouteRequest,
    RouteSource,
    cell,
    columns,
    reading_for,
    route_event,
    router_client_config,
)
from testing.clocks import JumpClock
from testing.export_source_fixtures import (
    ADMIN,
    USER,
    PagedRoute,
    all_rows,
    drained,
    expired_deadline,
    fixed_answer,
    long_deadline,
    numbered_items,
    resumes_from_every_row,
)

_COLUMNS = columns('name', 'rank', 'tags', 'rate=kpis.rate')


def _source(route: PagedRoute, *, page: int = 3, by_offset: bool = False) -> RouteSource:
    paging = Paging('offset', request_param='offset', limit=page) if by_offset else Paging(limit=page)
    route_list = RouteList('Items', _COLUMNS, 'stats-insights', '/api/items', 'items', paging, fixed={'view': 'items'})
    return RouteSource('sources', (route_list,), params=('scope', 'market_id'), invoker=route)


def test_rows_hold_every_item_in_route_order_when_the_route_pages_by_token() -> None:
    items = numbered_items(10)

    rows = all_rows(_source(PagedRoute(items)), {})

    assert [row.values[0] for row in rows] == [item['name'] for item in items]


def test_rows_hold_every_item_when_the_route_pages_by_offset() -> None:
    items = numbered_items(7)

    rows = all_rows(_source(PagedRoute(items, by_offset=True), by_offset=True), {})

    assert [row.values[1] for row in rows] == [1, 2, 3, 4, 5, 6, 7]


def test_columns_read_dotted_paths_and_join_scalar_lists() -> None:
    rows = all_rows(_source(PagedRoute(numbered_items(2))), {})

    assert rows[1].values == ('item-001', 2, 'a; b', 0.1)


def test_requests_forward_the_view_params_and_keep_the_fixed_ones() -> None:
    route = PagedRoute(numbered_items(2))

    all_rows(_source(route), {'scope': 'group:g1', 'market_id': ''})

    assert dict(route.requests[0].query) == {'scope': 'group:g1', 'view': 'items', 'limit': '3'}


@settings(max_examples=60, deadline=None)
@given(
    count=st.integers(min_value=0, max_value=17), page=st.integers(min_value=1, max_value=6),
    by_offset=st.booleans(), keyed=st.booleans(),
)
def test_resuming_after_any_row_yields_exactly_the_remaining_rows(count: int, page: int, by_offset: bool, keyed: bool) -> None:
    source = _source(PagedRoute(numbered_items(count), by_offset=by_offset), page=page, by_offset=by_offset)
    if keyed:
        source = replace(source, lists=(replace(source.lists[0], resume_key=('name',)),))
    assert resumes_from_every_row(source, {})


def test_a_computing_answer_stops_the_reads_and_asks_for_its_wait_instead_of_sleeping() -> None:
    route = PagedRoute(numbered_items(2), computing_first=1)

    with reading_for('alice') as read:
        rows, end = drained(_source(route).rows({}, None, long_deadline()))

    assert (rows, end, read.wait_seconds, len(route.requests)) == ([], RowsEnd.STOPPED, 1.5, 1)


def test_the_next_read_after_the_wait_reads_the_list() -> None:
    route = PagedRoute(numbered_items(2), computing_first=1)
    source = _source(route)
    with reading_for('alice'):
        drained(source.rows({}, None, long_deadline()))

    with reading_for('alice') as read:
        rows, end = drained(source.rows({}, None, long_deadline()))

    assert (len(rows), end, read.wait_seconds) == (2, RowsEnd.FINISHED, None)


def test_rows_stop_without_error_when_the_deadline_has_passed() -> None:
    route = PagedRoute(numbered_items(4))

    rows = list(_source(route).rows({}, None, expired_deadline()))

    assert (rows, route.requests) == ([], [])


def test_rows_end_finished_after_the_last_page() -> None:
    _rows, end = drained(_source(PagedRoute(numbered_items(4))).rows({}, None, long_deadline()))

    assert end is RowsEnd.FINISHED


def test_rows_end_stopped_when_a_page_leaves_less_than_the_router_reserve() -> None:
    clock = JumpClock()
    route = PagedRoute(numbered_items(10), clock=clock, request_seconds=599.5)

    rows, end = drained(_source(route).rows({}, None, clock.deadline(600)))

    assert (len(rows), end) == (3, RowsEnd.STOPPED)


def test_a_source_stopping_for_time_marks_the_deadline_cut() -> None:
    clock = JumpClock()
    deadline = clock.deadline(600)

    drained(_source(PagedRoute(numbered_items(10), clock=clock, request_seconds=599.5)).rows({}, None, deadline))

    assert (deadline.expired(), deadline.cut) == (False, True)


def test_a_page_its_filter_empties_is_followed_by_a_mark_at_the_next_page() -> None:
    route_list = RouteList('Items', _COLUMNS, 'stats-insights', '/api/items', 'items', Paging(limit=2), matches={'name': 'name'})
    source = RouteSource('sources', (route_list,), params=('name',), invoker=PagedRoute(numbered_items(5)))

    marks = [item for item in source.rows({'name': 'item-004'}, None, long_deadline()) if isinstance(item, ExportMark)]

    assert marks == [ExportMark({'list': 0, 'token': '2', 'skip': 0}), ExportMark({'list': 0, 'token': '4', 'skip': 0})]


def test_a_route_answering_its_own_cursor_as_the_next_fails_the_export() -> None:
    source = replace(_source(PagedRoute([])), invoker=fixed_answer(200, {'items': [], 'next_token': 'same'}))

    with pytest.raises(ExportSourceError, match='answered its own cursor'):
        all_rows(source, {}, {'list': 0, 'token': 'same', 'skip': 0})


def test_an_answer_without_the_list_key_fails_the_export() -> None:
    source = replace(_source(PagedRoute([])), invoker=fixed_answer(200, {'rows': [], 'next_token': None}))

    with pytest.raises(ExportSourceError, match='answered without its list items'):
        all_rows(source, {})


def test_an_optional_list_the_answer_leaves_out_has_no_rows() -> None:
    source = _source(PagedRoute([]))
    optional = replace(source, lists=(replace(source.lists[0], optional=True),), invoker=fixed_answer(200, {'gaps': []}))

    assert all_rows(optional, {}) == []


@pytest.mark.parametrize(('seconds_left', 'requests', 'rows', 'end'), [
    (ROUTER_READ_SECONDS + 1, 0, 0, RowsEnd.STOPPED),
    (INVOKE_START_SECONDS + 0.5, 1, 3, RowsEnd.FINISHED),
], ids=['too-close-to-start', 'still-fits'])
def test_a_route_read_starts_only_while_a_slow_router_still_answers_before_the_deadline(
    seconds_left: float, requests: int, rows: int, end: RowsEnd,
) -> None:
    clock = JumpClock()
    route = PagedRoute(numbered_items(3), clock=clock, request_seconds=ROUTER_READ_SECONDS)

    read, ended = drained(_source(route).rows({}, None, clock.deadline(seconds_left)))

    assert (len(route.requests), len(read), ended) == (requests, rows, end)


def test_the_router_client_makes_one_attempt_per_read() -> None:
    assert vars(router_client_config())['retries'] == {'mode': 'standard', 'total_max_attempts': 1}


def _newest_first(route: PagedRoute, *, by_offset: bool = False) -> RouteSource:
    paging = Paging('offset', request_param='offset', limit=3) if by_offset else Paging(limit=3)
    route_list = RouteList('Items', _COLUMNS, 'config-mgmt', '/api/alerts', 'items', paging, resume_key=('name',))
    return RouteSource('alerts', (route_list,), invoker=route)


def _newer(count: int) -> list[dict]:
    return [{'name': f'new-{index}', 'rank': 0} for index in range(count)]


@pytest.mark.parametrize('inserted', [1, 2, 7])
def test_rows_inserted_at_the_head_between_chunks_give_no_duplicate_and_no_gap(inserted: int) -> None:
    route = PagedRoute(numbered_items(8))
    source = _newest_first(route)
    first_chunk = all_rows(source, {})[:2]
    route.items[:0] = _newer(inserted)

    rest = all_rows(source, {}, json.loads(json.dumps(first_chunk[-1].cursor)))

    assert [row.values[0] for row in [*first_chunk, *rest]] == [f'item-{index:03d}' for index in range(8)]


def test_rows_inserted_at_the_head_while_an_offset_list_is_read_give_no_duplicate() -> None:
    route = PagedRoute(numbered_items(6), by_offset=True)
    source = _newest_first(route, by_offset=True)
    rows = source.rows({}, None, long_deadline())
    head = [next(rows) for _ in range(3)]
    route.items[:0] = _newer(2)

    names = [row.values[0] for row in [*head, *rows] if isinstance(row, ExportRow)]

    assert names == [f'item-{index:03d}' for index in range(6)]


def test_a_resumed_list_whose_last_written_row_is_gone_fails_the_export() -> None:
    route = PagedRoute(numbered_items(8))
    source = _newest_first(route)
    cursor = json.loads(json.dumps(all_rows(source, {})[1].cursor))
    del route.items[1]

    with pytest.raises(ExportSourceError, match='row the export had reached is gone'):
        all_rows(source, {}, cursor)


def _snapshot_lists(builds: Mapping[str, str | None]) -> RouteSource:
    """Two scoped lists whose answers say which snapshot build (``as_of``) they come from; ``builds`` by path (``None``: live)."""
    def invoke(request: RouteRequest) -> tuple[int, dict]:
        rows = [{'name': f'{request.path}-{index}'} for index in range(2)]
        as_of = builds[request.path]
        return 200, {'items': rows, 'next_token': None, 'source': 'live' if as_of is None else 'snapshot', 'as_of': as_of, 'stale': False}

    first = RouteList('Summary', columns('name'), 'stats-insights', '/api/visibility', 'items', Paging())
    second = RouteList('Keywords', columns('name'), 'stats-insights', '/api/visibility/keywords', 'items', Paging())
    return RouteSource('keyword-visibility', (first, second), invoker=invoke)


def test_lists_answered_from_one_snapshot_build_are_all_exported() -> None:
    source = _snapshot_lists({'/api/visibility': '2026-11-06T06:00:00Z', '/api/visibility/keywords': '2026-11-06T06:00:00Z'})

    assert [row.sheet for row in all_rows(source, {})] == ['Summary', 'Summary', 'Keywords', 'Keywords']


def test_a_live_list_beside_a_snapshot_list_is_exported() -> None:
    source = _snapshot_lists({'/api/visibility': '2026-11-06T06:00:00Z', '/api/visibility/keywords': None})

    assert len(all_rows(source, {})) == 4


def test_a_later_list_answered_from_a_newer_build_fails_the_export() -> None:
    source = _snapshot_lists({'/api/visibility': '2026-11-06T06:00:00Z', '/api/visibility/keywords': '2026-11-07T06:00:00Z'})

    with pytest.raises(ExportSourceError, match='rebuilt while the export ran'):
        all_rows(source, {})


def test_a_resumed_export_keeps_the_build_of_its_first_page() -> None:
    builds = {'/api/visibility': '2026-11-06T06:00:00Z', '/api/visibility/keywords': '2026-11-06T06:00:00Z'}
    cursor = json.loads(json.dumps(all_rows(_snapshot_lists(builds), {})[0].cursor))
    builds['/api/visibility'] = builds['/api/visibility/keywords'] = '2026-11-07T06:00:00Z'

    with pytest.raises(ExportSourceError, match='rebuilt while the export ran'):
        all_rows(_snapshot_lists(builds), {}, cursor)


def test_a_page_that_stays_partial_fails_the_export() -> None:
    with pytest.raises(ExportSourceError, match='kept answering a partial page'):
        all_rows(_source(PagedRoute(numbered_items(3), partial_first=10)), {})


def test_a_page_that_is_partial_once_is_asked_again_and_exported_whole() -> None:
    rows = all_rows(_source(PagedRoute(numbered_items(3), partial_first=1)), {})

    assert [row.values[1] for row in rows] == [1, 2, 3]


def test_an_error_answer_fails_the_export_with_the_route_message() -> None:
    source = replace(_source(PagedRoute([])), invoker=fixed_answer(400, {'error': 'Unknown group'}))

    with pytest.raises(ExportSourceError, match='/api/items answered 400: Unknown group'):
        all_rows(source, {})


def test_a_failed_view_job_fails_the_export() -> None:
    source = replace(_source(PagedRoute([])), invoker=fixed_answer(200, {'status': 'failed', 'message': 'boom'}))

    with pytest.raises(ExportSourceError, match='answered 200: boom'):
        all_rows(source, {})


def test_a_cursor_of_another_list_is_refused() -> None:
    with pytest.raises(ExportSourceError, match='does not belong'):
        all_rows(_source(PagedRoute(numbered_items(3))), {}, {'list': 4, 'token': None, 'skip': 0})


def test_validate_refuses_an_unknown_parameter() -> None:
    assert _source(PagedRoute([])).validate({'scope': 'all', 'limit': '5'}, USER) == 'Unknown parameter for the sources export: limit'


def test_validate_accepts_the_view_params() -> None:
    assert _source(PagedRoute([])).validate({'scope': 'all', 'market_id': 'es-es'}, USER) is None


def _two_lists(route: PagedRoute) -> RouteSource:
    first = RouteList('keywords', columns('name'), 'keyword-mgmt', '/api/keywords', 'items', Paging(limit=2))
    second = RouteList('users', columns('name'), 'manage-users', '/api/users', 'items', SINGLE, admin=True)
    return RouteSource('config-lists', (first, second), select='list', invoker=route)


def test_validate_refuses_an_admin_list_to_a_user() -> None:
    assert _two_lists(PagedRoute([])).validate({'list': 'users'}, USER) == 'Only an Admin may export this list'


def test_validate_refuses_a_list_that_does_not_exist() -> None:
    assert _two_lists(PagedRoute([])).validate({'list': 'nope'}, ADMIN) == 'list must be one of: keywords, users'


def test_the_selected_list_is_read_with_admin_claims_when_it_is_admin_only() -> None:
    route = PagedRoute(numbered_items(1))

    all_rows(_two_lists(route), {'list': 'users'})

    assert route_event(route.requests[0])['requestContext']['authorizer']['claims']['cognito:groups'] == 'Admin'


def test_lists_without_a_selector_follow_each_other_in_sheet_order() -> None:
    route = PagedRoute(numbered_items(3))
    source = replace(_two_lists(route), select=None)

    rows = all_rows(source, {})

    assert [row.sheet for row in rows] == ['keywords', 'keywords', 'keywords', 'users', 'users', 'users']


def test_path_param_fills_the_item_id_and_is_not_sent_as_a_query() -> None:
    route = PagedRoute(numbered_items(1))
    route_list = RouteList('job', columns('name'), 'keyword-mgmt', '/api/keyword-research/{id}', 'items', SINGLE, path_param='id')

    all_rows(RouteSource('keyword-research', (route_list,), params=('id',), invoker=route), {'id': 'job-9'})

    assert route.requests[0] == RouteRequest('keyword-mgmt', '/api/keyword-research/job-9', '/api/keyword-research/{id}', {}, {'id': 'job-9'})


def test_cell_writes_nested_values_as_compact_json() -> None:
    assert cell({'b': 1, 'a': [{'x': 2}]}) == json.dumps({'a': [{'x': 2}], 'b': 1})
