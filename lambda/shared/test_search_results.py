"""
Tests for shared.search_results — the SearchResults reads the report endpoints share.

- the table name comes from the required environment variable
- the keyword listing is one projected, capped Scan page without empty keywords
- the latest run is the newest timestamp's rows; missing timestamps sort first
"""

from __future__ import annotations

import pytest

from shared.search_results import (
    LATEST_RUN_ITEM_LIMIT,
    latest_run,
    query_latest_run,
    search_results_table_name,
)
from testing.env import cleared_env

_LATEST = '2026-09-18T10:00:00Z'
_OLDER = '2026-09-10T10:00:00Z'


def _row(timestamp: str | None, provider: str) -> dict[str, str]:
    row = {'provider': provider}
    if timestamp is not None:
        row['timestamp'] = timestamp
    return row


class TestSearchResultsTableName:
    def test_returns_the_configured_table_name(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv('DYNAMODB_TABLE_SEARCH_RESULTS', 'prod-search-results')

        assert search_results_table_name() == 'prod-search-results'

    def test_raises_key_error_when_the_variable_is_unset(self):
        with cleared_env('DYNAMODB_TABLE_SEARCH_RESULTS'), pytest.raises(KeyError, match='DYNAMODB_TABLE_SEARCH_RESULTS'):
            search_results_table_name()


class TestLatestRun:
    def test_keeps_only_the_rows_stamped_with_the_newest_timestamp(self):
        rows = [_row(_OLDER, 'openai'), _row(_LATEST, 'openai'), _row(_LATEST, 'gemini'), _row(_OLDER, 'gemini')]

        assert latest_run(rows) == (_LATEST, [_row(_LATEST, 'openai'), _row(_LATEST, 'gemini')])

    def test_treats_a_row_without_a_timestamp_as_older_than_any_stamped_row(self):
        rows = [_row(None, 'openai'), _row(_OLDER, 'gemini')]

        assert latest_run(rows) == (_OLDER, [_row(_OLDER, 'gemini')])

    def test_excludes_unstamped_rows_from_the_run_when_no_row_has_a_timestamp(self):
        rows = [_row(None, 'openai'), _row(None, 'gemini')]

        assert latest_run(rows) == ('', [])

    def test_returns_an_empty_run_for_no_rows(self):
        assert latest_run([]) == ('', [])


class _PagedPartition:
    """A SearchResults partition answered newest first in pages of ``Limit`` rows (``LastEvaluatedKey`` = the next index)."""

    def __init__(self, rows: list[dict[str, str]]) -> None:
        self.rows = rows
        self.calls = 0

    def query(self, **kwargs: object) -> dict[str, object]:
        self.calls += 1
        start_key = kwargs.get('ExclusiveStartKey')
        start = int(start_key['at']) if isinstance(start_key, dict) else 0
        limit = kwargs['Limit']
        end = start + (limit if isinstance(limit, int) else 0)
        page: dict[str, object] = {'Items': self.rows[start:end]}
        return {**page, 'LastEvaluatedKey': {'at': end}} if end < len(self.rows) else page


class TestQueryLatestRun:
    def test_reads_every_row_of_a_run_longer_than_a_page(self):
        run = [_row(_LATEST, f'provider-{index:03}') for index in range(LATEST_RUN_ITEM_LIMIT * 2 + 7)]
        table = _PagedPartition([*run, _row(_OLDER, 'openai')])

        assert query_latest_run(table, 'spa') == (_LATEST, run)

    def test_stops_at_the_page_that_reaches_an_older_run(self):
        run = [_row(_LATEST, f'provider-{index:03}') for index in range(LATEST_RUN_ITEM_LIMIT + 3)]
        table = _PagedPartition([*run, *(_row(_OLDER, f'old-{index:03}') for index in range(LATEST_RUN_ITEM_LIMIT * 3))])

        query_latest_run(table, 'spa')

        assert table.calls == 2

    def test_reads_one_page_when_the_run_fits_in_it(self):
        table = _PagedPartition([_row(_LATEST, 'openai'), _row(_OLDER, 'openai')])

        query_latest_run(table, 'spa')

        assert table.calls == 1
