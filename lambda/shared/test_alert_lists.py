"""Tests for shared.alert_lists: alert and content-change pages reach every item newest first, with the true total."""

from __future__ import annotations

from typing import Any

import pytest

from shared.alert_lists import COUNT_MAX_PAGES, BadCursorError, alerts_page, content_changes_page, count_query
from testing.memory_dynamodb import MemoryDynamo

_ALERTS = [
    {'id': f'alert-{index:03}', 'status': 'open' if index % 3 else 'acknowledged', 'created_at': f'2026-10-{1 + index // 10:02}T{index % 10:02}:00:00Z'}
    for index in range(137)
]
_CHANGES = [{'group_id': 'g1', 'changed_at': f'2026-10-{1 + index // 24:02}T{index % 24:02}:00:00Z', 'description': f'c{index}'} for index in range(61)]


@pytest.fixture
def tables() -> MemoryDynamo:
    dynamo = MemoryDynamo()
    dynamo.add('alerts', ('id',), {'StatusCreatedIndex': ('status', 'created_at')}).put_rows(_ALERTS)
    dynamo.add('changes', ('group_id', 'changed_at')).put_rows([*_CHANGES, {'group_id': 'g2', 'changed_at': '2026-10-01T00:00:00Z'}])
    return dynamo


def _all_alerts(table: Any, statuses: tuple[str, ...], limit: int) -> tuple[list[str], int]:
    page = alerts_page(table, statuses, limit, None)
    ids, total = [item['id'] for item in page.items], page.total
    while page.next_token:
        page = alerts_page(table, statuses, limit, page.next_token)
        ids.extend(item['id'] for item in page.items)
    return ids, total


def _newest_first(rows: list[dict[str, Any]], *keys: str) -> list[str]:
    return [row[keys[0]] for row in sorted(rows, key=lambda row: tuple(row[key] for key in keys[1:]), reverse=True)]


def test_pages_of_every_status_reach_every_alert_newest_first(tables):
    ids, _total = _all_alerts(tables.Table('alerts'), ('open', 'acknowledged'), 9)

    assert ids == _newest_first(_ALERTS, 'id', 'created_at', 'id')


def test_pages_of_one_status_reach_its_alerts_only(tables):
    ids, _total = _all_alerts(tables.Table('alerts'), ('acknowledged',), 7)

    assert ids == _newest_first([alert for alert in _ALERTS if alert['status'] == 'acknowledged'], 'id', 'created_at', 'id')


def test_the_total_counts_every_alert_of_the_statuses_not_the_page(tables):
    assert alerts_page(tables.Table('alerts'), ('open',), 5, None).total == sum(alert['status'] == 'open' for alert in _ALERTS)


def test_a_token_of_another_status_list_is_a_bad_cursor(tables):
    token = alerts_page(tables.Table('alerts'), ('open',), 5, None).next_token

    with pytest.raises(BadCursorError, match=r'.'):
        alerts_page(tables.Table('alerts'), ('open', 'acknowledged'), 5, token)


def test_content_change_pages_reach_every_marker_of_the_group_newest_first(tables):
    table = tables.Table('changes')
    page = content_changes_page(table, 'g1', 8, None)
    stamps = [item['changed_at'] for item in page.items]
    while page.next_token:
        page = content_changes_page(table, 'g1', 8, page.next_token)
        stamps.extend(item['changed_at'] for item in page.items)

    assert (stamps, page.total) == (sorted((change['changed_at'] for change in _CHANGES), reverse=True), 61)


def test_a_content_change_token_of_another_group_is_a_bad_cursor(tables):
    token = content_changes_page(tables.Table('changes'), 'g1', 8, None).next_token

    with pytest.raises(BadCursorError, match=r'.'):
        content_changes_page(tables.Table('changes'), 'g2', 8, token)


class _EndlessCount:
    def query(self, **_params: Any) -> dict[str, Any]:
        return {'Count': 3, 'LastEvaluatedKey': {'id': 'more'}}


def test_a_count_stopped_at_its_page_cap_says_it_is_approximate():
    assert count_query(_EndlessCount()) == (3 * COUNT_MAX_PAGES, True)
