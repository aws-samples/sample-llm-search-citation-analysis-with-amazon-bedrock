"""An in-memory DynamoDB table that pages like the real one, for pagination and volume tests.

``MagicMock`` tables answer whatever a test tells them, which cannot show
that following ``next_token`` returns every row exactly once. ``PagedTable``
holds rows and answers ``query`` / ``scan`` the way DynamoDB does for the
arguments the paginated handlers send: a partition (of the table or of a GSI)
in sort-key order, ``ScanIndexForward``, ``Limit``, ``ExclusiveStartKey``,
``LastEvaluatedKey`` and an aliased ``ProjectionExpression``. Wrap it in
``MagicMock(wraps=...)`` to also assert on the calls.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from boto3.dynamodb.conditions import ConditionBase


def _partition_value(condition: ConditionBase) -> tuple[str, Any]:
    """``(attribute, value)`` of a ``Key(name).eq(value)`` condition."""
    key, value = condition.get_expression()['values']
    return key.name, value


@dataclass
class PagedTable:
    """Rows plus the key schema of the table (``indexes[None]``) and of each GSI.

    A key schema is ``(partition, sort)``; a table keyed by its partition
    alone (queried only through a GSI) is ``(partition,)``.
    """

    rows: list[dict[str, Any]]
    indexes: Mapping[str | None, tuple[str, ...]]
    max_page_rows: int | None = None
    """DynamoDB's 1 MB page cut, as a row count: a page stops here even below ``Limit``."""
    failures: dict[Any, Exception] = field(default_factory=dict)
    """Partition values whose query raises the given error."""

    def _key_attributes(self, index_name: str | None) -> list[str]:
        names = list(self.indexes[None])
        if index_name is not None:
            names += [name for name in self.indexes[index_name] if name not in names]
        return names

    def _ordered(self, rows: list[dict[str, Any]], sort_key: str, forward: bool) -> list[dict[str, Any]]:
        table_key = self.indexes[None]
        ordered = sorted(rows, key=lambda row: (row.get(sort_key, ''), *(row[name] for name in table_key)))
        return ordered if forward else ordered[::-1]

    def _page(self, ordered: list[dict[str, Any]], params: Mapping[str, Any], key_names: Sequence[str]) -> dict[str, Any]:
        start = params.get('ExclusiveStartKey')
        if start is not None:
            positions = [index for index, row in enumerate(ordered) if all(row.get(n) == start[n] for n in key_names)]
            ordered = ordered[positions[0] + 1:] if positions else []
        size = min(params.get('Limit', len(ordered)), self.max_page_rows or len(ordered))
        page = ordered[:size]
        response: dict[str, Any] = {'Items': [_project(row, params) for row in page]}
        if len(ordered) > size and page:
            response['LastEvaluatedKey'] = {name: page[-1][name] for name in key_names}
        return response

    def query(self, **params: Any) -> dict[str, Any]:
        index_name = params.get('IndexName')
        partition_key, sort_key = self.indexes[index_name]
        name, value = _partition_value(params['KeyConditionExpression'])
        assert name == partition_key, f'query on {name}, the partition key is {partition_key}'
        if value in self.failures:
            raise self.failures[value]
        rows = [row for row in self.rows if row.get(partition_key) == value]
        ordered = self._ordered(rows, sort_key, params.get('ScanIndexForward', True))
        return self._page(ordered, params, self._key_attributes(index_name))

    def scan(self, **params: Any) -> dict[str, Any]:
        return self._page(list(self.rows), params, self._key_attributes(None))


def _project(row: dict[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    projection = params.get('ProjectionExpression')
    if projection is None:
        return dict(row)
    names = params.get('ExpressionAttributeNames', {})
    wanted = [names.get(part.strip(), part.strip()) for part in projection.split(',')]
    return {name: row[name] for name in wanted if name in row}
