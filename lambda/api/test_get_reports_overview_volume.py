"""Volume tests for GET /api/reports/overview.

The overview is the trend view of ``/trends`` plus the top recommendations:
a small response over the same unbounded read (100 keywords x 365 days x 24
answers = 876,000 rows at ``days=365``). It now reads the window as
``/trends`` does, at most ``WINDOW_ROWS_CAP`` rows, and passes on where a cut
window stopped (``truncated_before``). The recommendations are stubbed: their
reads belong to ``get-recommendations.py``.
"""

from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.module_loader import load_handler_module
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.response_size import assert_within_page_budget
from testing.window_rows_fixtures import run_timestamp, volume_group

_HERE = os.path.dirname(os.path.abspath(__file__))

with patch('boto3.resource', MagicMock()), patch.dict(os.environ, REPORT_TABLES_ENV):
    _overview = load_handler_module(_HERE, 'get-reports-overview.py', 'get_reports_overview_volume_under_test')
    _trends = load_handler_module(_HERE, 'get-historical-trends.py', 'get_historical_trends_for_overview_volume')

RUN_COUNT = 30
GROUP = volume_group(100, RUN_COUNT, 24)


def _call() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The overview of the group with its real trend view, and the SearchResults rows read for it."""
    resource, rows_read = GROUP.resource()
    event = {'httpMethod': 'GET', 'path': '/api/reports/overview', 'queryStringParameters': {'group_id': 'coruna'}, 'headers': {}}
    with (
        patch.object(_overview, 'dynamodb', resource),
        patch.object(_trends, 'dynamodb', resource),
        patch.object(_overview, 'get_brand_config', return_value={'first_party_domains': ['hotel-coruna-mar.es']}),
        patch.object(_trends, 'history_since', return_value='2026-01-01T00:00:00.000000Z'),
        patch.dict(_overview._sibling_cache, {'trends': _trends.trends_for_scope, 'recs': lambda _config, keywords=None: []}),
    ):
        return _overview.handler(event, None), rows_read


@pytest.fixture(scope='module')
def capped_read() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    with patch('shared.scoped_reports.rows_per_keyword', return_value=240):
        response, rows_read = _call()
    return json.loads(response['body']), rows_read


def test_stays_within_page_budget_when_a_hundred_keyword_group_has_30_daily_runs():
    assert_within_page_budget(_call()[0])


def test_reads_at_most_the_cap_when_the_window_holds_more_rows(capped_read):
    assert len(capped_read[1]) <= 100 * (240 + 1)


def test_reports_the_run_the_trend_read_stopped_at(capped_read):
    assert capped_read[0]['truncated_before'] == run_timestamp(RUN_COUNT - 11)
