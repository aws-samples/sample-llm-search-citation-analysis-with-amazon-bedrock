"""Stored SearchResults rows, a SearchResults table fake and the report DynamoDB resource around it.

Shared by the scoped report tests (``testing.report_scope_fixtures``), the
sentiment-examples tests (``testing.sentiment_examples_fixtures``) and the
group KPI history tests. The table fake answers ``query`` per partition
(``keyword``), honouring the sort-key condition on ``timestamp_provider``
(``begins_with``, ``<``, ``>=``), ``ScanIndexForward=False`` and ``Limit``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
from unittest.mock import MagicMock

from testing.assertions import present
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table

SEARCH_RESULTS_TABLE_NAME = 'test-search-results'
KEYWORDS_TABLE_NAME = 'test-keywords'


class PartitionReadFailure(Exception):
    """A SearchResults partition that cannot be read."""


def search_result_row(
    keyword: str,
    provider: str,
    brands: Sequence[Mapping[str, Any]],
    *,
    timestamp: str,
    query_prompt_id: str = 'default',
    **fields: object,
) -> dict[str, Any]:
    """One stored SearchResults row; ``fields`` adds or overrides attributes (``response``, ``status`` ...)."""
    return {
        'keyword': keyword,
        'timestamp': timestamp,
        'timestamp_provider': f'{timestamp}#{provider}#{query_prompt_id}',
        'provider': provider,
        'query_prompt_id': query_prompt_id,
        'brands': [dict(brand) for brand in brands],
        'citations': [],
        **fields,
    }


def key_parts(condition: Any) -> tuple[str, Any]:
    """The partition value and the sort-key condition (or ``None``) of a key condition."""
    expression = condition.get_expression()
    if expression['operator'] == 'AND':
        partition, sort = expression['values']
        return partition.get_expression()['values'][1], sort
    return expression['values'][1], None


def sort_condition(query_kwargs: Mapping[str, Any]) -> tuple[str, str]:
    """The operator and value of a query's sort-key condition."""
    sort = present(key_parts(query_kwargs['KeyConditionExpression'])[1])
    return sort.expression_operator, sort.get_expression()['values'][1]


def _sort_key_matches(row: Mapping[str, Any], sort: Any) -> bool:
    if sort is None:
        return True
    value = sort.get_expression()['values'][1]
    if sort.expression_operator == 'begins_with':
        return row['timestamp_provider'].startswith(value)
    if sort.expression_operator == '<':
        return row['timestamp_provider'] < value
    assert sort.expression_operator == '>='
    return row['timestamp_provider'] >= value


def search_results_table(rows_by_keyword: Mapping[str, Sequence[Mapping[str, Any]] | Exception]) -> MagicMock:
    """A SearchResults ``Table`` whose ``query`` answers from ``rows_by_keyword``.

    A keyword mapped to an exception raises it on every read; an unknown
    keyword answers an empty page. Rows are copies in stored order (newest
    ``timestamp_provider`` first with ``ScanIndexForward=False``), cut to ``Limit``.
    """

    def query(**kwargs: Any) -> dict[str, Any]:
        keyword, sort = key_parts(kwargs['KeyConditionExpression'])
        stored = rows_by_keyword.get(keyword, [])
        if isinstance(stored, Exception):
            raise stored
        rows = [dict(row) for row in stored if _sort_key_matches(row, sort)]
        if kwargs.get('ScanIndexForward') is False:
            rows.sort(key=lambda row: row['timestamp_provider'], reverse=True)
        return {'Items': rows[:kwargs['Limit']] if 'Limit' in kwargs else rows}

    table = MagicMock(name='search-results')
    table.query.side_effect = query
    return table


def report_dynamodb(
    search_table: MagicMock,
    keywords_table: MagicMock | None = None,
    other_tables: Mapping[str, MagicMock] | None = None,
) -> MagicMock:
    """A DynamoDB resource: ``test-search-results`` is ``search_table``, ``test-keywords`` is ``keywords_table``.

    ``keywords_table`` defaults to one listing no keywords. Every other table
    name (unless given in ``other_tables``) answers empty pages, so a handler
    reading the wrong table finds nothing instead of paginating a bare
    ``MagicMock`` forever.
    """
    return fake_dynamodb_resource(
        fake_table(query={'Items': []}),
        by_name={
            SEARCH_RESULTS_TABLE_NAME: search_table,
            KEYWORDS_TABLE_NAME: keywords_table or active_keywords_table(()),
            **(other_tables or {}),
        },
    )


def active_keywords_table(active: Sequence[Mapping[str, Any]]) -> MagicMock:
    """A Keywords ``Table`` whose ``StatusIndex`` query lists ``active``."""
    return fake_table(query={'Items': list(active)})
