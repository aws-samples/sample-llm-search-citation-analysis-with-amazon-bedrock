"""SearchResults fakes for the two-phase reads of the answer text (``/visibility/sentiment-examples``).

``projected_search_table`` answers like ``search_results_table`` but leaves
the answer text (``response``) out of every row unless the Query projects it
(``#rsp``), as DynamoDB's ``ProjectionExpression`` does; ``serve_answer_texts``
makes a resource's ``batch_get_item`` answer the rows asked for by key, so a
test sees where the text came from.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
from unittest.mock import MagicMock

from testing.search_results_fixtures import report_dynamodb, search_results_table


def projected_search_table(rows_by_keyword: Mapping[str, Sequence[Mapping[str, Any]] | Exception]) -> MagicMock:
    """A SearchResults ``Table`` whose ``query`` drops ``response`` from its rows unless the projection asks for it."""
    table = search_results_table(rows_by_keyword)
    answer = table.query.side_effect

    def query(**kwargs: Any) -> dict[str, Any]:
        response = answer(**kwargs)
        if '#rsp' in kwargs.get('ProjectionExpression', '#rsp'):
            return response
        return {**response, 'Items': [{key: value for key, value in row.items() if key != 'response'} for row in response['Items']]}

    table.query.side_effect = query
    return table


def serve_answer_texts(resource: MagicMock, rows_by_keyword: Mapping[str, Sequence[Mapping[str, Any]] | Exception]) -> list[list[dict[str, Any]]]:
    """Make ``resource.batch_get_item`` answer the stored rows at the keys asked for; returns the list of key lists asked.

    A keyword mapped to an exception (a partition that cannot be queried) has no rows to answer.
    """
    stored = {
        (row['keyword'], row['timestamp_provider']): dict(row)
        for rows in rows_by_keyword.values() if not isinstance(rows, Exception)
        for row in rows
    }
    asked: list[list[dict[str, Any]]] = []

    def batch_get_item(**kwargs: Any) -> dict[str, Any]:
        (table_name, request), = kwargs['RequestItems'].items()
        asked.append(list(request['Keys']))
        found = [stored[key] for key in ((item['keyword'], item['timestamp_provider']) for item in request['Keys']) if key in stored]
        return {'Responses': {table_name: found}, 'UnprocessedKeys': {}}

    resource.batch_get_item.side_effect = batch_get_item
    return asked


def answer_texts_dynamodb(
    rows_by_keyword: Mapping[str, Sequence[Mapping[str, Any]] | Exception],
    keywords_table: MagicMock | None = None,
    search_table: MagicMock | None = None,
) -> MagicMock:
    """A report DynamoDB resource over ``rows_by_keyword`` that projects the answer text away and serves it by key.

    ``search_table`` (default ``projected_search_table(rows_by_keyword)``) lets a test inspect the Queries.
    """
    table = search_table if search_table is not None else projected_search_table(rows_by_keyword)
    resource = report_dynamodb(table, keywords_table)
    serve_answer_texts(resource, rows_by_keyword)
    return resource
