"""Tests for the KPI rollup the Deduplication Lambda writes when a keyword's run is done, and its backfill action (``run_kpis_action``)."""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.keyword_run_kpis import BRANDS_PER_RUN, tally_from_item
from shared.keyword_run_kpis_backfill import RollupNotDeployedError
from shared.kpi_engine import answers_from_rows
from shared.kpi_tally import run_tally
from testing.client_errors import throttled
from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.keyword_run_kpis_fixtures import ROLLUP_ENV, ROLLUP_TABLE_NAME, rollup_table
from testing.module_loader import load_handler_module_offline
from testing.provider_summary_fixtures import provider_row
from testing.window_rows_fixtures import group_window_rows, paged_search_results_table, run_timestamp, volume_keyword

_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
_KEYWORD = volume_keyword(0)
_ROWS = group_window_rows(1, 3, answers_per_run=4)
_OWNED = ['hotel-coruna-mar.es']
_ENV = {
    'DYNAMODB_TABLE_CITATIONS': 'test-citations',
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
}


def _load(env: dict[str, str]) -> Any:
    with patch.dict(os.environ, {**_ENV, **env}):
        return load_handler_module_offline(_HANDLER_DIR, 'handler.py', 'deduplication_rollup_under_test')


def _event(timestamp: str = run_timestamp(2)) -> dict[str, Any]:
    return {'keyword': _KEYWORD, 'timestamp': timestamp, 'results': [provider_row('openai', ['https://a.example'])]}


@pytest.fixture
def stored() -> dict[str, list[dict[str, Any]]]:
    return {}


@pytest.fixture
def dedup(stored):
    """The dedup module with SearchResults holding ``_ROWS`` and an in-memory rollup table ``stored``."""
    module = _load({})
    resource = fake_dynamodb_resource(by_name={
        'test-search-results': paged_search_results_table(_ROWS),
        ROLLUP_TABLE_NAME: rollup_table(stored),
    })
    with (
        patch.dict(os.environ, {**_ENV, **ROLLUP_ENV}),
        patch.object(module.run_kpis_action, 'dynamodb', resource),
        patch.object(module, 'citations_table', MagicMock()),
        patch.object(module.run_kpis_action, 'get_brand_config', return_value={'first_party_domains': _OWNED}),
    ):
        yield module


class TestWorkflowWrite:
    def test_writes_the_runs_rollup_from_every_row_of_the_run(self, dedup, stored):
        dedup.handler(_event(), None)

        expected = run_tally(_KEYWORD, run_timestamp(2), [a for a in answers_from_rows(_ROWS[_KEYWORD]) if a.timestamp == run_timestamp(2)], _OWNED, brand_cap=BRANDS_PER_RUN)
        assert [tally_from_item(item) for item in stored[_KEYWORD]] == [expected]

    def test_writing_a_run_again_replaces_its_row(self, dedup, stored):
        dedup.handler(_event(), None)
        dedup.handler(_event(), None)

        assert len(stored[_KEYWORD]) == 1

    def test_writes_the_rollup_of_a_run_without_results(self, dedup, stored):
        dedup.handler({**_event(run_timestamp(1)), 'results': []}, None)

        assert [item['run_timestamp'] for item in stored[_KEYWORD]] == [run_timestamp(1)]

    def test_a_failed_rollup_write_still_answers_the_keywords_citations(self, dedup):
        dedup.run_kpis_action.dynamodb.Table(ROLLUP_TABLE_NAME).put_item.side_effect = throttled('PutItem')

        assert dedup.handler(_event(), None)['keyword'] == _KEYWORD

    def test_a_failed_rollup_write_is_counted_in_a_metric(self, dedup, capsys):
        dedup.run_kpis_action.dynamodb.Table(ROLLUP_TABLE_NAME).put_item.side_effect = throttled('PutItem')

        dedup.handler(_event(), None)

        metrics = [line for line in capsys.readouterr().out.splitlines() if 'KeywordRunKpisWriteFailure' in line]
        assert [('"Stage":"workflow"' in line, '"KeywordRunKpisWriteFailure":1}' in line) for line in metrics] == [(True, True)]

    def test_writes_nothing_where_the_rollup_table_is_not_deployed(self, dedup, stored, monkeypatch):
        monkeypatch.delenv('DYNAMODB_TABLE_KEYWORD_RUN_KPIS')

        dedup.handler(_event(), None)

        assert stored == {}


class TestBackfillAction:
    def test_rolls_up_every_run_of_the_keywords_given(self, dedup, stored):
        response = dedup.handler({'action': 'backfill_keyword_run_kpis', 'keywords': [_KEYWORD]}, None)

        assert (response['done'], [item['run_timestamp'] for item in stored[_KEYWORD]]) == (True, [run_timestamp(index) for index in range(3)])

    def test_rolls_up_the_keywords_of_the_keywords_table_without_a_list(self, dedup, stored):
        keywords = MagicMock()
        keywords.scan.return_value = {'Items': [{'keyword': _KEYWORD}, {'keyword': 'never analysed'}]}
        dedup.run_kpis_action.dynamodb.Table.side_effect = {
            'test-search-results': paged_search_results_table(_ROWS), ROLLUP_TABLE_NAME: rollup_table(stored), 'test-keywords': keywords,
        }.get

        response = dedup.handler({'action': 'backfill_keyword_run_kpis'}, None)

        assert (response['keywords_done'], response['runs_written']) == (2, 3)

    def test_refuses_to_backfill_where_the_rollup_table_is_not_deployed(self, dedup, monkeypatch):
        monkeypatch.delenv('DYNAMODB_TABLE_KEYWORD_RUN_KPIS')

        with pytest.raises(RollupNotDeployedError, match='DYNAMODB_TABLE_KEYWORD_RUN_KPIS'):
            dedup.handler({'action': 'backfill_keyword_run_kpis', 'keywords': [_KEYWORD]}, None)
