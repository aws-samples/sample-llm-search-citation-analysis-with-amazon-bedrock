"""Volume tests for GET /api/trends.

The response is small (one point per period, one row per keyword); the read
was not: every row of every keyword in the window, 100 keywords x 365 days x
24 answers = 876,000 rows (~1.7 GB projected) at ``days=365``, which runs
past API Gateway's 29 s long before the response is built. The window is now
read newest first, at most ``WINDOW_ROWS_CAP`` rows over all keywords, and a
cut window says where it stopped (``truncated_before``). The cap is scaled
down here (``rows_per_keyword``) so the data set stays small enough for a
unit test while still holding more rows than the cap.
"""

from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.kpi_engine import answers_from_rows
from shared.visibility_views import trend_view
from testing.module_loader import load_handler_module
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.response_size import assert_within_page_budget
from testing.window_rows_fixtures import run_timestamp, volume_group

_HERE = os.path.dirname(os.path.abspath(__file__))

with patch('boto3.resource', MagicMock()), patch.dict(os.environ, REPORT_TABLES_ENV):
    _mod = load_handler_module(_HERE, 'get-historical-trends.py', 'get_historical_trends_volume_under_test')

RUN_COUNT = 15
ANSWERS_PER_RUN = 24
GROUP = volume_group(100, RUN_COUNT, ANSWERS_PER_RUN)
OWNED = ['hotel-coruna-mar.es']

#: Ten runs of every keyword: the scaled-down cap the window holds more rows than.
SCALED_ROWS_PER_KEYWORD = 10 * ANSWERS_PER_RUN


def _call() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The response to a group trend request, and the SearchResults rows it read."""
    resource, rows_read = GROUP.resource()
    event = {'httpMethod': 'GET', 'path': '/api/trends', 'queryStringParameters': {'group_id': 'coruna'}, 'headers': {}}
    with (
        patch.object(_mod, 'dynamodb', resource),
        patch.object(_mod, 'get_brand_config', return_value={'first_party_domains': OWNED}),
        patch.object(_mod, 'history_since', return_value='2026-01-01T00:00:00.000000Z'),
    ):
        return _mod.handler(event, None), rows_read


@pytest.fixture(scope='module')
def whole_read() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    return _call()


@pytest.fixture(scope='module')
def capped_read() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    with patch('shared.scoped_reports.rows_per_keyword', return_value=SCALED_ROWS_PER_KEYWORD):
        response, rows_read = _call()
    return json.loads(response['body']), rows_read


def test_stays_within_page_budget_when_a_hundred_keyword_group_is_read_whole(whole_read):
    assert_within_page_budget(whole_read[0])


def test_reads_every_row_when_the_window_is_under_the_cap(whole_read):
    response, rows_read = whole_read

    assert (len(rows_read), json.loads(response['body'])['truncated_before']) == (100 * RUN_COUNT * ANSWERS_PER_RUN, None)


def test_reads_at_most_the_cap_when_the_window_holds_more_rows(capped_read):
    assert len(capped_read[1]) <= 100 * (SCALED_ROWS_PER_KEYWORD + 1)


def test_reports_the_run_the_read_stopped_at_when_the_cap_cuts_the_window(capped_read):
    assert capped_read[0]['truncated_before'] == run_timestamp(RUN_COUNT - 11)


def test_trend_numbers_of_a_cut_window_equal_a_whole_read_of_the_runs_after_the_cut(capped_read):
    body = capped_read[0]
    cut = body['truncated_before']
    answers = {keyword: [answer for answer in answers_from_rows(GROUP.rows[keyword]) if answer.timestamp > cut] for keyword in GROUP.keywords}

    expected = trend_view(GROUP.keywords, answers, 'day', OWNED)

    assert (body['trend_data'], body['latest'], body['keyword_trends']) == (
        expected['trend_data'], expected['latest'], expected['keyword_trends'],
    )
