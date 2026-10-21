"""Volume tests for GET /api/reports/group-kpis.

Before the views, one response held every keyword's runs (~1 KB per keyword
per run) and every compared run's drivers (~0.5 KB per moved keyword): the
40-keyword group with 120 daily runs below built about 6.6 MB of JSON
(``test_the_data_set_built_well_over_the_lambda_cap_in_one_response`` proves it),
and 100 keywords at the 90-day default about 13 MB. Now the summary grows
with the runs only (about 0.2 MB here), and the per-keyword runs and per-run
drivers are pages of at most the page budget.
"""

from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.group_kpi_history import build_group_kpi_history
from shared.response_budget import LAMBDA_RESPONSE_LIMIT_BYTES, json_bytes
from testing.module_loader import load_handler_module
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.response_size import assert_within_page_budget
from testing.window_rows_fixtures import run_timestamp, volume_group

_HERE = os.path.dirname(os.path.abspath(__file__))

with patch('boto3.resource', MagicMock()), patch.dict(os.environ, REPORT_TABLES_ENV):
    _mod = load_handler_module(_HERE, 'get-group-kpi-history.py', 'get_group_kpi_history_volume_under_test')

KEYWORD_COUNT = 40
RUN_COUNT = 120
GROUP = volume_group(KEYWORD_COUNT, RUN_COUNT)
OWNED = ['hotel-coruna-mar.es']


def _call(params: dict[str, str], rows_read: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The response to a group-kpis request; the SearchResults rows it read are added to ``rows_read``."""
    resource, read = GROUP.resource()
    event = {'httpMethod': 'GET', 'path': '/api/reports/group-kpis', 'queryStringParameters': {'group_id': 'coruna', **params}, 'headers': {}}
    with (
        patch.object(_mod, 'dynamodb', resource),
        patch.object(_mod, 'get_brand_config', return_value={'first_party_domains': OWNED}),
        patch.object(_mod, 'history_since', return_value='2026-01-01T00:00:00.000000Z'),
    ):
        response = _mod.handler(event, None)
    (rows_read if rows_read is not None else []).extend(read)
    return response


def _body(response: dict[str, Any]) -> dict[str, Any]:
    return json.loads(response['body'])


def _follow(params: dict[str, str], key: str) -> list[list[dict[str, Any]]]:
    """Every page of ``key`` from the first page to the last ``next_token``."""
    pages: list[list[dict[str, Any]]] = []
    token: str | None = None
    while True:
        body = _body(_call({**params, **({'next_token': token} if token else {})}))
        pages.append(body[key])
        token = body['next_token']
        if token is None:
            return pages


@pytest.fixture(scope='module')
def full_history() -> dict[str, Any]:
    return build_group_kpi_history(GROUP.keywords, GROUP.rows, OWNED)


@pytest.fixture(scope='module')
def summary_response() -> dict[str, Any]:
    return _call({})


@pytest.fixture(scope='module')
def keyword_pages() -> list[list[dict[str, Any]]]:
    return _follow({'view': 'keywords'}, 'keywords')


@pytest.fixture(scope='module')
def driver_pages() -> list[list[dict[str, Any]]]:
    return _follow({'view': 'drivers'}, 'changes')


def test_the_data_set_built_well_over_the_lambda_cap_in_one_response(full_history):
    assert json_bytes(full_history) > LAMBDA_RESPONSE_LIMIT_BYTES


def test_stays_within_page_budget_when_a_forty_keyword_group_has_120_daily_runs(summary_response):
    assert_within_page_budget(summary_response)


def test_summary_keeps_every_run_when_a_forty_keyword_group_has_120_daily_runs(summary_response):
    body = _body(summary_response)

    assert (len(body['runs']), body['runs_truncated'], body['truncated_before']) == (RUN_COUNT, False, None)


def test_summary_group_kpis_equal_the_full_history_computation(summary_response, full_history):
    assert [run['kpis'] for run in _body(summary_response)['runs']] == [run['kpis'] for run in full_history['runs']]


def test_summary_reports_the_run_the_read_stopped_at_when_the_window_holds_more_rows_than_the_cap():
    with patch('shared.scoped_reports.rows_per_keyword', return_value=80):
        body = _body(_call({}))

    assert (body['truncated_before'], len(body['runs'])) == (run_timestamp(RUN_COUNT - 11), 10)


def test_stays_within_page_budget_when_keyword_runs_are_paged_for_120_daily_runs():
    assert_within_page_budget(_call({'view': 'keywords', 'limit': '25'}))


def test_keyword_pages_return_every_keyword_exactly_once_in_order(keyword_pages):
    assert [entry['keyword'] for page in keyword_pages for entry in page] == GROUP.keywords


def test_keyword_pages_hold_the_runs_of_the_full_history(keyword_pages, full_history):
    paged = [entry['runs'] for page in keyword_pages for entry in page]

    assert paged == [entry['runs'] for entry in full_history['keywords']]


def test_stays_within_page_budget_when_drivers_are_paged_for_120_daily_runs():
    assert_within_page_budget(_call({'view': 'drivers'}))


def test_driver_pages_return_every_compared_run_exactly_once_in_order(driver_pages):
    timestamps = [change['timestamp'] for page in driver_pages for change in page]

    assert timestamps == [run_timestamp(index) for index in range(1, RUN_COUNT)]


def test_driver_pages_hold_the_drivers_of_the_full_history(driver_pages, full_history):
    paged = [change['drivers'] for page in driver_pages for change in page]

    assert paged == [run['change']['drivers'] for run in full_history['runs'] if run['change'] is not None]


def test_one_runs_drivers_read_from_its_previous_group_run_equal_the_full_history(full_history):
    body = _body(_call({'view': 'drivers', 'from_run': run_timestamp(59), 'to_run': run_timestamp(60)}))

    assert body['changes'] == [{
        'timestamp': run_timestamp(60),
        'previous_timestamp': run_timestamp(59),
        'drivers': full_history['runs'][60]['change']['drivers'],
    }]


def test_one_runs_drivers_read_only_the_two_runs():
    rows_read: list[dict[str, Any]] = []

    _call({'view': 'drivers', 'from_run': run_timestamp(59), 'to_run': run_timestamp(60)}, rows_read)

    assert len(rows_read) == KEYWORD_COUNT * 2 * 8


@pytest.mark.parametrize('view', ['keywords', 'drivers'])
def test_refuses_a_malformed_next_token_with_a_400(view):
    response = _call({'view': view, 'next_token': 'not-a-cursor'})

    assert (response['statusCode'], _body(response)['field']) == (400, 'next_token')
