"""Exact-run loading and API-parity tests for shared visibility metrics."""

from __future__ import annotations

from unittest.mock import MagicMock

from shared.visibility_metrics import (
    METRICS_PROJECTION,
    calculate_keyword_visibility,
    query_exact_visibility_rows,
)

RUN_TIMESTAMP = '2026-10-01T10:00:00Z'
NEWER_TIMESTAMP = '2026-10-01T11:00:00Z'


def _brand(name: str, classification: str, rank: int) -> dict:
    return {
        'name': name,
        'classification': classification,
        'mention_count': 1,
        'rank': rank,
        'first_position': rank * 10,
        'sentiment': 'neutral',
    }


def _row(timestamp: str, provider: str, rank: int) -> dict:
    return {
        'timestamp': timestamp,
        'provider': provider,
        'brands': [_brand('Hotel Mine', 'first_party', rank)],
    }


class TestExactTimestampSelection:
    def test_uses_requested_run_when_newer_rows_are_present(self) -> None:
        rows = [
            _row(RUN_TIMESTAMP, 'openai', 2),
            _row(NEWER_TIMESTAMP, 'gemini', 1),
        ]

        result = calculate_keyword_visibility(
            'hotels',
            rows,
            4,
            exact_timestamp=RUN_TIMESTAMP,
        )

        assert result['timestamp'] == RUN_TIMESTAMP
        assert result['first_party'][0]['best_rank'] == 2
        assert result['prominence']['answers'] == 1

    def test_returns_no_data_when_requested_run_is_absent(self) -> None:
        result = calculate_keyword_visibility(
            'hotels',
            [_row(NEWER_TIMESTAMP, 'openai', 1)],
            4,
            exact_timestamp=RUN_TIMESTAMP,
        )

        assert result == {'error': 'No data found for keyword'}

    def test_keeps_latest_run_selection_when_timestamp_is_omitted(self) -> None:
        rows = [
            _row(RUN_TIMESTAMP, 'openai', 2),
            _row(NEWER_TIMESTAMP, 'gemini', 1),
        ]

        result = calculate_keyword_visibility('hotels', rows, 4)

        assert result['timestamp'] == NEWER_TIMESTAMP
        assert result['first_party'][0]['best_rank'] == 1


class TestExactTimestampQuery:
    def test_follows_every_projected_query_page(self) -> None:
        table = MagicMock()
        table.query.side_effect = [
            {
                'Items': [_row(RUN_TIMESTAMP, 'openai', 1)],
                'LastEvaluatedKey': {
                    'keyword': 'hotels',
                    'timestamp_provider': f'{RUN_TIMESTAMP}#openai#default',
                },
            },
            {'Items': [_row(RUN_TIMESTAMP, 'gemini', 2)]},
        ]

        rows = query_exact_visibility_rows(table, 'hotels', RUN_TIMESTAMP)

        assert [row['provider'] for row in rows] == ['openai', 'gemini']
        assert table.query.call_count == 2
        assert table.query.call_args_list[1].kwargs['ExclusiveStartKey']['keyword'] == 'hotels'

    def test_projects_only_fields_used_by_metrics(self) -> None:
        table = MagicMock()
        table.query.return_value = {'Items': []}

        query_exact_visibility_rows(table, 'hotels', RUN_TIMESTAMP)

        request = table.query.call_args.kwargs
        assert request['ProjectionExpression'] == METRICS_PROJECTION
        assert request['ExpressionAttributeNames'] == {'#ts': 'timestamp'}

    def test_constrains_the_sort_key_to_the_exact_run_prefix(self) -> None:
        table = MagicMock()
        table.query.return_value = {'Items': []}

        query_exact_visibility_rows(table, 'hotels', RUN_TIMESTAMP)

        expression = table.query.call_args.kwargs['KeyConditionExpression'].get_expression()
        assert expression['operator'] == 'AND'
        assert expression['values'][1].get_expression()['values'][1] == f'{RUN_TIMESTAMP}#'
