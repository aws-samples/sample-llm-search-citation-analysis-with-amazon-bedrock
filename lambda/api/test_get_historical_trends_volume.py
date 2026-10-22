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

from shared.kpi_engine import answers_from_rows
from shared.visibility_views import trend_view
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

_mod = load_window_report('get-historical-trends.py', 'get_historical_trends_volume_under_test')

RUN_COUNT = 15
ANSWERS_PER_RUN = 24
GROUP = volume_group(100, RUN_COUNT, ANSWERS_PER_RUN)
OWNED = ['hotel-coruna-mar.es']

#: Ten runs of every keyword: the scaled-down cap the window holds more rows than.
SCALED_ROWS_PER_KEYWORD = 10 * ANSWERS_PER_RUN


def _call() -> WindowRead:
    """The response to a group trend request, and the SearchResults rows it read."""
    resource, rows_read = GROUP.resource()
    with windowed_report(_mod, resource, brand_config={'first_party_domains': OWNED}):
        return _mod.handler(report_event('/api/trends', {'group_id': 'coruna'}), None), rows_read


whole_read = whole_read_fixture(_call)
capped_read = capped_read_fixture(_call, SCALED_ROWS_PER_KEYWORD)


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
