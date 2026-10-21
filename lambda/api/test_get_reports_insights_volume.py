"""Volume tests for GET /api/reports/insights.

The response is small (facts and insights, ~0.5 MB at most); the read for a
keyword group was not: the stability facts read every row of the last
``days`` days, the same read ``/reports/group-kpis`` made (100 keywords x 90
days x 24 answers = 216,000 rows at the default), to keep only each keyword's
runs. It is now the bounded window read of ``shared.scoped_reports``, and a
cut window is reported in ``history_truncated_before``.
"""

from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.group_kpi_history import build_group_kpi_history
from shared.insights_engine import stability_facts
from testing.module_loader import load_handler_module
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.response_size import assert_within_page_budget
from testing.window_rows_fixtures import run_timestamp, volume_group

_HERE = os.path.dirname(os.path.abspath(__file__))

with patch('boto3.resource', MagicMock()), patch.dict(os.environ, REPORT_TABLES_ENV):
    _mod = load_handler_module(_HERE, 'get-reports-insights.py', 'get_reports_insights_volume_under_test')

RUN_COUNT = 90
GROUP = volume_group(40, RUN_COUNT)
OWNED = ['hotel-coruna-mar.es']


def _call() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The insights of the group, and the SearchResults rows read for them."""
    resource, rows_read = GROUP.resource()
    event = {'httpMethod': 'GET', 'path': '/api/reports/insights', 'queryStringParameters': {'group_id': 'coruna'}, 'headers': {}}
    with (
        patch.object(_mod, 'dynamodb', resource),
        patch.object(_mod, 'get_brand_config', return_value={'first_party_domains': OWNED}),
        patch.object(_mod, 'history_since', return_value='2026-01-01T00:00:00.000000Z'),
        patch.object(_mod, 'load_narrative', return_value=None),
    ):
        return _mod.handler(event, None), rows_read


@pytest.fixture(scope='module')
def whole_read() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    return _call()


@pytest.fixture(scope='module')
def capped_read() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    with patch('shared.scoped_reports.rows_per_keyword', return_value=80):
        response, rows_read = _call()
    return json.loads(response['body']), rows_read


def test_stays_within_page_budget_when_a_forty_keyword_group_has_90_daily_runs(whole_read):
    assert_within_page_budget(whole_read[0])


def test_stability_facts_equal_those_of_the_full_history(whole_read):
    expected = stability_facts(build_group_kpi_history(GROUP.keywords, GROUP.rows, OWNED)['keywords'])

    assert json.loads(whole_read[0]['body'])['facts']['stability'] == expected


def test_reads_at_most_the_cap_when_the_window_holds_more_rows(capped_read):
    # The capped history read, plus the latest run of every keyword (8 rows each, and one newest-row lookup).
    assert len(capped_read[1]) <= 40 * (80 + 1) + 40 * (8 + 1)


def test_reports_the_run_the_history_read_stopped_at(capped_read):
    assert capped_read[0]['history_truncated_before'] == run_timestamp(RUN_COUNT - 11)
