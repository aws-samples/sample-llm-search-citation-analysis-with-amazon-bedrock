"""
Tests for shared.search_results — the SearchResults reads the report endpoints share.

- the table name comes from the required environment variable
- the keyword listing is one projected, capped Scan page without empty keywords
- the latest run is the newest timestamp's rows; missing timestamps sort first
"""

from __future__ import annotations

import pytest

from shared.search_results import (
    DEFAULT_KEYWORD_SCAN_LIMIT,
    latest_run,
    scan_keyword_texts,
    search_results_table_name,
)
from testing.dynamodb_stubs import fake_table
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


class TestScanKeywordTexts:
    def test_returns_the_keyword_of_every_row_that_has_one(self):
        table = fake_table(scan={'Items': [{'keyword': 'shoes'}, {'keyword': ''}, {}, {'keyword': 'boots'}]})

        assert scan_keyword_texts(table) == ['shoes', 'boots']

    def test_scans_one_projected_page_capped_at_the_default_limit(self):
        table = fake_table(scan={'Items': []})

        scan_keyword_texts(table)

        table.scan.assert_called_once_with(ProjectionExpression='keyword', Limit=DEFAULT_KEYWORD_SCAN_LIMIT)

    def test_passes_an_explicit_limit_to_the_scan(self):
        table = fake_table(scan={'Items': []})

        scan_keyword_texts(table, limit=25)

        assert table.scan.call_args.kwargs['Limit'] == 25


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
