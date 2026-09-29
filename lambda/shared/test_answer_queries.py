"""Tests for shared/answer_queries.py — the bounded, projected reads of a keyword's answers."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

import pytest

from shared.answer_queries import (
    history_since,
    latest_run_timestamp,
    previous_run_timestamp,
    query_keyword_rows_since,
    query_keyword_run_rows,
    query_last_two_runs_rows,
)

RUN_1 = '2026-09-01T06:00:00.000000Z'
RUN_2 = '2026-09-08T06:00:00.000000Z'


def _key_condition(call: Any) -> tuple[Any, Any]:
    """The partition and sort-key parts of a query's key condition."""
    condition = call.kwargs['KeyConditionExpression'].get_expression()
    assert condition['operator'] == 'AND'
    return condition['values'][0].get_expression(), condition['values'][1]


def _sort_condition(call: Any) -> tuple[str, str, str]:
    _partition, sort = _key_condition(call)
    return sort.expression_operator, sort.get_expression()['values'][0].name, sort.get_expression()['values'][1]


class TestWindowAndRunQueries:
    @pytest.mark.parametrize('query', [query_keyword_rows_since, query_keyword_run_rows])
    def test_reads_one_keyword_partition(self, query):
        table = MagicMock()
        table.query.return_value = {'Items': [{'timestamp': RUN_1}]}

        rows = query(table, 'hotel malaga', RUN_1)

        partition, _sort = _key_condition(table.query.call_args)
        assert (rows, partition['values'][0].name, partition['values'][1]) == ([{'timestamp': RUN_1}], 'keyword', 'hotel malaga')

    def test_reads_the_window_from_its_start_through_the_sort_key(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        query_keyword_rows_since(table, 'hotel malaga', RUN_1)

        assert _sort_condition(table.query.call_args) == ('>=', 'timestamp_provider', RUN_1)

    def test_reads_one_run_through_the_sort_key_prefix(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        query_keyword_run_rows(table, 'hotel malaga', RUN_2)

        assert _sort_condition(table.query.call_args) == ('begins_with', 'timestamp_provider', f'{RUN_2}#')

    @pytest.mark.parametrize('query', [query_keyword_rows_since, query_keyword_run_rows])
    def test_projects_the_answer_fields(self, query):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        query(table, 'hotel malaga', RUN_1)

        kwargs = table.query.call_args.kwargs
        assert (kwargs['ProjectionExpression'], kwargs['ExpressionAttributeNames']) == (
            'keyword, #ts, provider, #st, query_prompt_id, brands, citations, #md.model',
            {'#ts': 'timestamp', '#st': 'status', '#md': 'metadata'},
        )

    @pytest.mark.parametrize('query', [query_keyword_rows_since, query_keyword_run_rows])
    def test_follows_pagination(self, query):
        table = MagicMock()
        table.query.side_effect = [
            {'Items': [{'timestamp': RUN_1}], 'LastEvaluatedKey': {'keyword': 'k'}},
            {'Items': [{'timestamp': RUN_2}]},
        ]

        assert query(table, 'hotel malaga', RUN_1) == [{'timestamp': RUN_1}, {'timestamp': RUN_2}]


class TestLatestRun:
    def test_reads_only_the_newest_row_of_the_keyword(self):
        table = MagicMock()
        table.query.return_value = {'Items': [{'timestamp': RUN_2}]}

        latest_run_timestamp(table, 'hotel malaga')

        kwargs = table.query.call_args.kwargs
        partition = kwargs['KeyConditionExpression'].get_expression()
        assert (partition['values'][0].name, partition['values'][1], kwargs['ScanIndexForward'], kwargs['Limit']) == (
            'keyword', 'hotel malaga', False, 1,
        )
        assert kwargs['ProjectionExpression'] == '#ts'

    def test_names_the_timestamp_attribute(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        latest_run_timestamp(table, 'hotel malaga')

        assert table.query.call_args.kwargs['ExpressionAttributeNames'] == {'#ts': 'timestamp'}

    @pytest.mark.parametrize(('items', 'expected'), [
        ([{'timestamp': RUN_2}], RUN_2),
        ([], None),
        ([{'timestamp': ''}], None),
        ([{}], None),
    ])
    def test_answers_the_newest_run_timestamp_or_none(self, items, expected):
        table = MagicMock()
        table.query.return_value = {'Items': items}

        assert latest_run_timestamp(table, 'hotel malaga') == expected

    def test_answers_none_when_the_response_has_no_items(self):
        table = MagicMock()
        table.query.return_value = {}

        assert latest_run_timestamp(table, 'hotel malaga') is None

    def test_reads_every_row_of_the_latest_and_the_previous_run(self):
        table = MagicMock()
        table.query.side_effect = [
            {'Items': [{'timestamp': RUN_2}]},
            {'Items': [{'timestamp': RUN_1}]},
            {'Items': [{'timestamp': RUN_1, 'provider': 'gemini'}]},
            {'Items': [{'timestamp': RUN_2, 'provider': 'openai'}]},
        ]

        latest, previous = query_last_two_runs_rows(table, 'hotel malaga')

        prefixes = [_sort_condition(call)[2] for call in table.query.call_args_list[2:]]
        assert (latest, previous, prefixes) == (
            [{'timestamp': RUN_2, 'provider': 'openai'}], [{'timestamp': RUN_1, 'provider': 'gemini'}], [f'{RUN_1}#', f'{RUN_2}#'],
        )

    def test_reads_the_latest_run_alone_when_there_is_no_previous_one(self):
        table = MagicMock()
        table.query.side_effect = [{'Items': [{'timestamp': RUN_2}]}, {'Items': []}, {'Items': [{'timestamp': RUN_2}]}]

        assert query_last_two_runs_rows(table, 'hotel malaga') == ([{'timestamp': RUN_2}], [])

    def test_reads_nothing_more_for_a_keyword_never_analysed(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        assert (query_last_two_runs_rows(table, 'hotel malaga'), table.query.call_count) == (([], []), 1)


class TestPreviousRun:
    def test_reads_the_newest_row_strictly_before_the_run(self):
        table = MagicMock()
        table.query.return_value = {'Items': [{'timestamp': RUN_1}]}

        timestamp = previous_run_timestamp(table, 'hotel malaga', RUN_2)

        kwargs = table.query.call_args.kwargs
        partition, _sort = _key_condition(table.query.call_args)
        assert (timestamp, _sort_condition(table.query.call_args), partition['values'][0].name, kwargs['ScanIndexForward']) == (
            RUN_1, ('<', 'timestamp_provider', RUN_2), 'keyword', False,
        )
        assert kwargs['Limit'] == 1

    def test_projects_only_the_timestamp(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        previous_run_timestamp(table, 'hotel malaga', RUN_2)

        kwargs = table.query.call_args.kwargs
        assert (kwargs['ProjectionExpression'], kwargs['ExpressionAttributeNames']) == ('#ts', {'#ts': 'timestamp'})

    @pytest.mark.parametrize(('response', 'expected'), [
        ({'Items': [{'timestamp': RUN_1}]}, RUN_1),
        ({'Items': []}, None),
        ({'Items': [{'timestamp': ''}]}, None),
        ({}, None),
    ])
    def test_answers_the_previous_run_timestamp_or_none(self, response, expected):
        table = MagicMock()
        table.query.return_value = response

        assert previous_run_timestamp(table, 'hotel malaga', RUN_2) == expected



class TestHistorySince:
    def test_formats_the_window_start_like_run_timestamps(self):
        now = datetime(2026, 9, 28, 12, 30, 15, 123456, tzinfo=UTC)

        assert history_since(90, now) == '2026-06-30T12:30:15.123456Z'

    def test_defaults_to_the_current_time(self):
        assert history_since(0) <= datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%S.%fZ')
