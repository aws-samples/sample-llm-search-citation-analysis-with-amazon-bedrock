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
from unittest.mock import patch

from shared.group_kpi_history import build_group_kpi_history
from shared.insights_engine import stability_facts
from testing.response_size import assert_within_page_budget
from testing.window_rows_fixtures import (
    WindowRead,
    capped_read_fixture,
    load_window_report,
    report_event,
    run_timestamp,
    volume_group,
    whole_read_fixture,
    windowed_report,
)

_mod = load_window_report('get-reports-insights.py', 'get_reports_insights_volume_under_test')

RUN_COUNT = 90
GROUP = volume_group(40, RUN_COUNT)
OWNED = ['hotel-coruna-mar.es']


def _call() -> WindowRead:
    """The insights of the group, and the SearchResults rows read for them."""
    resource, rows_read = GROUP.resource()
    with (
        windowed_report(_mod, resource, brand_config={'first_party_domains': OWNED}),
        patch.object(_mod, 'load_narrative', return_value=None),
    ):
        return _mod.handler(report_event('/api/reports/insights', {'group_id': 'coruna'}), None), rows_read


whole_read = whole_read_fixture(_call)
capped_read = capped_read_fixture(_call, 80)


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
