"""GET /api/visibility: complete for every scope (2.45.0), live under the budget and from the scope snapshot over it.

The S1 store functions (``open_snapshot``, ``view_job_response``) are replaced
by fakes; the stored build is the ``latest`` builder's fold of the same rows,
so the snapshot answer is compared with the uncapped live answer (the oracle).
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import patch

import pytest

from shared.snapshot_artifacts import (
    SnapshotCursor,
    decode_snapshot_cursor,
)
from testing.dynamodb_stubs import fake_table
from testing.handler_fixtures import handler_fixture
from testing.kpi_route_fixtures import (
    BRAND_CONFIG,
    drained,
    from_build,
    kpi_route,
    latest_build,
    live_scope_fields,
    served_and_live,
)
from testing.kpi_scope_fixtures import scope_keywords, snapshot_store, without
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.window_budget_fixtures import one_scope_worker, request_deadline_of, ticking_deadline

visibility_handler = handler_fixture(
    os.path.dirname(os.path.abspath(__file__)), 'get-visibility-metrics.py', 'get_visibility_metrics_sources_under_test', env=REPORT_TABLES_ENV,
)

_BRAND_CONFIG = {**BRAND_CONFIG, 'tracked_brands': {'first_party': ['Hotel Sol'], 'competitors': ['Rival 3']}}

#: Without a QueryPrompts table the route assumes 10 personas x 4 engines x 2 runs = 80 rows a keyword: 100 keywords fit the budget.
_LIVE_MAX = 100

#: The fields only the snapshot path pages or labels differently.
_PAGING = ('keywords', 'keywords_next_token', 'coverage', 'source', 'as_of', 'stale', 'refreshing')
_ALL = {'scope': 'all'}



@pytest.fixture
def live_150(visibility_handler) -> Any:
    personas = {'test-query-prompts': fake_table(query={'Count': 0, 'Items': []})}
    with (
        patch.dict(os.environ, {'DYNAMODB_TABLE_QUERY_PROMPTS': 'test-query-prompts'}),
        kpi_route(visibility_handler, '/api/visibility', scope_keywords(150), other_tables=personas, brand_config=_BRAND_CONFIG) as route,
    ):
        yield route


@pytest.fixture
def large(visibility_handler) -> Any:
    with kpi_route(visibility_handler, '/api/visibility', scope_keywords(_LIVE_MAX + 1), brand_config=_BRAND_CONFIG) as route:
        yield route


@pytest.fixture
def summary(large) -> tuple[dict[str, Any], dict[str, Any]]:
    return served_and_live(large, _ALL, latest_build(large.keywords), 'kpi_route')


class TestLive:
    def test_answers_every_keyword_of_a_scope_over_the_old_cap(self, live_150) -> None:
        _status, body = live_150.call(_ALL)

        assert (len(body['keywords']), body['keywords_analyzed'], body['keywords_truncated']) == (150, 150, False)

    def test_reports_complete_live_coverage(self, live_150) -> None:
        _status, body = live_150.call(_ALL)

        assert {name: body[name] for name in ('coverage', 'source', 'as_of', 'stale', 'refreshing')} == live_scope_fields(150)

    def test_holds_every_keyword_row_without_a_next_token(self, live_150) -> None:
        _status, body = live_150.call(_ALL)

        assert (body['keywords_total'], body['keywords_next_token']) == (150, None)

    def test_says_partial_coverage_when_the_budget_cut_the_read(self, live_150) -> None:
        with one_scope_worker(), request_deadline_of(lambda: ticking_deadline(2)):
            _status, body = live_150.call(_ALL)

        assert (body['keywords_truncated'], body['coverage']) == (True, {'keywords_total': 150, 'keywords_analyzed': 1, 'complete': False})

    def test_never_reads_the_snapshot(self, live_150) -> None:
        with snapshot_store(None) as job:
            live_150.call(_ALL)

        assert job.call_count == 0


class TestSnapshot:
    def test_serves_the_body_the_live_path_computes(self, summary) -> None:
        served, live = summary

        assert without(served, *_PAGING) == without(live, *_PAGING)

    def test_first_page_holds_the_live_rows_in_scope_order(self, summary) -> None:
        served, live = summary

        assert served['keywords'] == live['keywords'][:100]

    def test_pages_join_into_every_keyword_in_scope_order(self, large) -> None:
        with snapshot_store(latest_build(large.keywords)):
            _status, first = large.call(_ALL)
            rows = drained(first, 'keywords', 'keywords_next_token', lambda token: large.call({**_ALL, 'view': 'keywords', 'next_token': token})[1])

        assert [row['keyword'] for row in rows] == large.keywords

    def test_first_token_points_past_the_first_page_of_this_build(self, large) -> None:
        _status, body, _job = from_build(large, latest_build(large.keywords, build_id='build-0042'), _ALL)

        assert decode_snapshot_cursor(body['keywords_next_token']) == SnapshotCursor(offset=100, build_id='build-0042')

    def test_answers_202_for_a_persona_the_build_does_not_hold(self, large) -> None:
        status, _body, job = from_build(large, latest_build(large.keywords), {**_ALL, 'query_prompt_id': 'family'})

        assert (status, job.call_args.args[0], job.call_args.args[1]['persona']) == (202, 'visibility', 'family')

    def test_loads_three_artifacts_for_the_summary(self, large) -> None:
        stored = latest_build(large.keywords)
        with snapshot_store(stored):
            large.call(_ALL)

        assert sorted(stored.loads) == ['latest/_all', 'latest/brands-_all', 'latest/keywords-_all']
