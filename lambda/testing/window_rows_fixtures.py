"""Large windows of SearchResults rows and a paginating table fake for the windowed report volume tests.

``paged_search_results_table`` answers ``query`` per partition (``keyword``)
like DynamoDB does for a window read: the sort-key conditions ``>=``,
``BETWEEN``, ``begins_with`` and ``<``, ``ScanIndexForward=False``, ``Limit``,
and pages of ``page_size`` items linked by ``LastEvaluatedKey`` /
``ExclusiveStartKey``. ``group_window_rows`` builds a realistic history: every
keyword answered by every engine in every daily run, with accented Spanish
brand names, sentiment reasons and citations, and positions that move from run
to run so every compared run has drivers.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock

from testing.response_size import long_text
from testing.search_results_fixtures import key_parts, search_result_row

#: The eight answer engines of a large tenant.
VOLUME_PROVIDERS = ('openai', 'perplexity', 'gemini', 'claude', 'openai', 'perplexity', 'gemini', 'claude')

#: Personas a large tenant asks each keyword through (with ``VOLUME_PROVIDERS``: 8 answers a run).
VOLUME_PERSONAS = ('viajero', 'familia', 'negocios', 'default', 'lujo', 'escapada', 'grupo', 'mayores')

_FIRST_RUN = datetime(2026, 5, 1, 6, 0, tzinfo=UTC)


def run_timestamp(index: int) -> str:
    """The timestamp of the ``index``-th daily run (0 = the oldest)."""
    return (_FIRST_RUN + timedelta(days=index)).strftime('%Y-%m-%dT%H:%M:%S.000000Z')


def volume_keyword(index: int) -> str:
    """A realistic Spanish keyword of a hotel group, unique per ``index``."""
    return f'hotel con encanto en la coruña número {index:03} con piscina climatizada y desayuno'


def _brands(keyword_index: int, run_index: int) -> list[dict[str, Any]]:
    rank = 1 + (keyword_index + run_index) % 4
    return [
        {
            'name': 'Hotel Coruña Mar',
            'classification': 'first_party',
            'rank': rank,
            'sentiment': 'positive',
            'sentiment_reason': long_text(160),
        },
        {
            'name': f'Competidor Galicia {keyword_index % 7}',
            'classification': 'competitor',
            'rank': 5 - rank,
            'sentiment': 'neutral',
            'sentiment_reason': long_text(160),
        },
    ]


def group_window_rows(keyword_count: int, run_count: int, answers_per_run: int = 8) -> dict[str, list[dict[str, Any]]]:
    """``answers_per_run`` successful answers of every keyword in every one of ``run_count`` daily runs."""
    rows: dict[str, list[dict[str, Any]]] = {}
    for keyword_index in range(keyword_count):
        keyword = volume_keyword(keyword_index)
        rows[keyword] = [
            search_result_row(
                keyword,
                VOLUME_PROVIDERS[answer % len(VOLUME_PROVIDERS)],
                _brands(keyword_index, run_index),
                timestamp=run_timestamp(run_index),
                query_prompt_id=VOLUME_PERSONAS[answer % len(VOLUME_PERSONAS)],
                citations=[f'https://www.hotel-coruna-mar.es/habitación-{run_index}', 'https://www.turismo-galicia.es/guía'],
                metadata={'model': 'gpt-5-mini'},
            )
            for run_index in range(run_count)
            for answer in range(answers_per_run)
        ]
    return rows


def _matches(sort_key: str, sort: Any) -> bool:
    if sort is None:
        return True
    operator = sort.expression_operator
    values = sort.get_expression()['values']
    if operator == 'BETWEEN':
        return values[1] <= sort_key <= values[2]
    value = values[1]
    if operator == 'begins_with':
        return sort_key.startswith(value)
    if operator == '<':
        return sort_key < value
    assert operator == '>='
    return sort_key >= value


def paged_search_results_table(rows_by_keyword: Mapping[str, Sequence[Mapping[str, Any]]], page_size: int = 400) -> MagicMock:
    """A SearchResults ``Table`` whose ``query`` pages through ``rows_by_keyword`` as DynamoDB would."""

    def query(**kwargs: Any) -> dict[str, Any]:
        keyword, sort = key_parts(kwargs['KeyConditionExpression'])
        rows = sorted(
            (row for row in rows_by_keyword.get(keyword, []) if _matches(row['timestamp_provider'], sort)),
            key=lambda row: row['timestamp_provider'],
            reverse=kwargs.get('ScanIndexForward') is False,
        )
        start = int(kwargs['ExclusiveStartKey']['offset']) if 'ExclusiveStartKey' in kwargs else 0
        size = min(page_size, kwargs.get('Limit', page_size))
        page = [dict(row) for row in rows[start:start + size]]
        response: dict[str, Any] = {'Items': page}
        if start + size < len(rows):
            response['LastEvaluatedKey'] = {'offset': start + size}
        return response

    table = MagicMock(name='paged-search-results')
    table.query.side_effect = query
    return table
