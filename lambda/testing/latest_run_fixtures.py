"""A SearchResults table whose unordered reads answer one oldest-first page, as DynamoDB does past 1 MB.

The persona-rankings and self-reflection handlers once took "the latest run"
from the first ascending page of a keyword partition; once the partition
outgrew one page, that page held only the oldest runs. This fake reproduces
it: a Query with no sort-key condition and no ``ScanIndexForward=False``
answers just the oldest row (plus a ``LastEvaluatedKey``); any other Query
answers from ``testing.search_results_fixtures.search_results_table``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
from unittest.mock import MagicMock

from testing.search_results_fixtures import key_parts, search_results_table


def oldest_page_first_table(rows_by_keyword: Mapping[str, Sequence[Mapping[str, Any]]]) -> MagicMock:
    """A SearchResults ``Table`` whose whole-partition ascending Query stops after the oldest row."""
    table = search_results_table(rows_by_keyword)
    answer = table.query.side_effect

    def query(**kwargs: Any) -> dict[str, Any]:
        keyword, sort = key_parts(kwargs['KeyConditionExpression'])
        if sort is not None or kwargs.get('ScanIndexForward') is False:
            return answer(**kwargs)
        stored = sorted(rows_by_keyword.get(keyword, []), key=lambda row: row['timestamp_provider'])
        if not stored:
            return {'Items': []}
        oldest = dict(stored[0])
        return {
            'Items': [oldest],
            'LastEvaluatedKey': {'keyword': keyword, 'timestamp_provider': oldest['timestamp_provider']},
        }

    table.query.side_effect = query
    return table
