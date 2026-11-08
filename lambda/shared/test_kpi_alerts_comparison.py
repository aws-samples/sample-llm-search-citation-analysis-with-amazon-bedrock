"""KPI alerts judged like for like: only comparable runs raise alerts, on the answers of their matched cells."""

from __future__ import annotations

from typing import Any

from shared.kpi_alerts import DEFAULT_ALERT_SETTINGS, KPI_VERSION, comparison_alerts
from shared.kpi_comparison import compare_runs

_BEFORE = '2026-09-01T10:00:00Z'
_AFTER = '2026-09-08T10:00:00Z'
_HOTEL = {'name': 'Hotel Sol', 'classification': 'first_party', 'rank': 1}
_SETTINGS = {**DEFAULT_ALERT_SETTINGS, 'notification_emails': []}


def _row(provider: str, timestamp: str, *, mentioned: bool, **fields: Any) -> dict[str, Any]:
    """One answer of 'hotel spa' that names the hotel first, or names nothing."""
    return {
        'keyword': 'hotel spa', 'timestamp': timestamp, 'provider': provider, 'status': 'success',
        'query_prompt_id': 'default', 'brands': [_HOTEL] if mentioned else [], 'citations': [], **fields,
    }


def _snapshot(timestamp: str) -> dict[str, Any]:
    return {'group_id': 'group-1', 'snapshot_at': timestamp, 'kpi_version': KPI_VERSION}


def _alert_types(before: list[dict[str, Any]], after: list[dict[str, Any]]) -> list[str]:
    comparison = compare_runs(before, after)
    alerts = comparison_alerts(_snapshot(_BEFORE), _snapshot(_AFTER), comparison, _SETTINGS)
    return [alert['type'] for alert in alerts]


class TestComparisonAlerts:
    def test_raises_a_mention_rate_drop_on_the_matched_cells(self):
        before = [_row('openai', _BEFORE, mentioned=True)]
        after = [_row('openai', _AFTER, mentioned=False)]

        assert _alert_types(before, after) == ['mention_rate_drop', 'keyword_lost_mention']

    def test_ignores_a_newly_enabled_engine_that_dilutes_the_pooled_rate(self):
        before = [_row('openai', _BEFORE, mentioned=True)]
        after = [_row('openai', _AFTER, mentioned=True), _row('claude', _AFTER, mentioned=False)]

        assert _alert_types(before, after) == []

    def test_ignores_a_drop_that_only_branded_answers_show(self):
        before = [_row('openai', _BEFORE, mentioned=True), _row('gemini', _BEFORE, mentioned=True, branded=True)]
        after = [_row('openai', _AFTER, mentioned=True), _row('gemini', _AFTER, mentioned=False, branded=True)]

        assert _alert_types(before, after) == []

    def test_raises_nothing_when_the_runs_share_no_cell(self):
        before = [_row('openai', _BEFORE, mentioned=True)]
        after = [_row('claude', _AFTER, mentioned=False)]

        assert _alert_types(before, after) == []

    def test_raises_nothing_when_the_current_run_is_incomplete(self):
        before = [_row('openai', _BEFORE, mentioned=True)]
        after = [_row('openai', _AFTER, mentioned=False), {**_row('claude', _AFTER, mentioned=False), 'status': 'error'}]

        assert _alert_types(before, after) == []

    def test_raises_nothing_without_a_previous_snapshot(self):
        comparison = compare_runs(None, [_row('openai', _AFTER, mentioned=False)])

        assert comparison_alerts(None, _snapshot(_AFTER), comparison, _SETTINGS) == []
