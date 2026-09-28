"""Run selection tests for shared visibility metrics."""

from __future__ import annotations

from shared.visibility_metrics import calculate_keyword_visibility

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
