"""An in-memory DynamoDB resource for end-to-end tests: every table, its GSIs, conditions, pages and projections.

``MemoryDynamo`` stands in for ``boto3.resource('dynamodb')`` across several
handlers and writers at once, so a test can run the real Deduplication writer,
the real snapshot build and the real route handlers over one tenant. Tables
answer what the code sends:

- ``query`` with a boto3 ``Key`` condition on a table or a GSI (``eq`` on the
  partition, ``eq`` / ``lt`` / ``lte`` / ``gt`` / ``gte`` / ``between`` /
  ``begins_with`` on the sort key), ``FilterExpression`` (boto3 ``Attr``
  conditions), ``ScanIndexForward``, ``Limit``, ``ExclusiveStartKey`` /
  ``LastEvaluatedKey``, ``ProjectionExpression`` with ``ExpressionAttributeNames``
  and ``Select='COUNT'``;
- ``scan`` (whole, or one ``Segment`` of ``TotalSegments``), ``get_item``, ``put_item``, ``delete_item``, ``batch_writer``, and the
  resource's ``batch_get_item``;
- numbers come back as ``Decimal``, as from DynamoDB.

Every read is recorded per table (``reads``) so tests can assert read counts.
"""

from __future__ import annotations

from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from boto3.dynamodb.conditions import ConditionBase

from testing.partition_tables import project, rows_after

#: Rows one page holds at most (DynamoDB's 1 MB cut, as a row count).
PAGE_ROWS = 200


def stored(value: Any) -> Any:
    """``value`` as DynamoDB hands it back: every number a ``Decimal``, sets and lists kept."""
    if isinstance(value, bool) or value is None or isinstance(value, (str, Decimal)):
        return value
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, Mapping):
        return {str(key): stored(item) for key, item in value.items()}
    if isinstance(value, (set, frozenset)):
        return {stored(item) for item in value}
    if isinstance(value, (list, tuple)):
        return [stored(item) for item in value]
    return value


def _operand(value: Any, row: Mapping[str, Any]) -> Any:
    name = getattr(value, 'name', None)
    return row.get(name) if name is not None and hasattr(value, 'name') else value


def _compare(operator: str, left: Any, right: Any) -> bool:
    if left is None:
        return False
    checks = {'=': left == right, '<>': left != right, '<': left < right, '<=': left <= right, '>': left > right, '>=': left >= right}
    return checks[operator]


def matches(condition: ConditionBase, row: Mapping[str, Any]) -> bool:
    """Whether ``row`` satisfies a boto3 ``Key`` / ``Attr`` condition."""
    expression = condition.get_expression()
    operator, values = expression['operator'], expression['values']
    if operator in ('AND', 'OR'):
        results = [matches(value, row) for value in values]
        return all(results) if operator == 'AND' else any(results)
    if operator == 'NOT':
        return not matches(values[0], row)
    left = _operand(values[0], row)
    if operator in ('=', '<>', '<', '<=', '>', '>='):
        return _compare(operator, left, _operand(values[1], row))
    if operator == 'BETWEEN':
        return left is not None and values[1] <= left <= values[2]
    if operator == 'begins_with':
        return isinstance(left, str) and left.startswith(values[1])
    if operator == 'contains':
        return left is not None and values[1] in left
    if operator == 'attribute_exists':
        return values[0].name in row
    if operator == 'attribute_not_exists':
        return values[0].name not in row
    if operator == 'IN':
        return left in values[1]
    raise NotImplementedError(f'condition {operator!r}')


_ANY = object()


def _partition_of(condition: ConditionBase, partition_key: str) -> Any:
    """The value ``condition`` requires of ``partition_key`` (``eq``, alone or in an AND), or ``_ANY``."""
    expression = condition.get_expression()
    if expression['operator'] == 'AND':
        for value in expression['values']:
            found = _partition_of(value, partition_key)
            if found is not _ANY:
                return found
        return _ANY
    values = expression['values']
    if expression['operator'] == '=' and getattr(values[0], 'name', None) == partition_key:
        return values[1]
    return _ANY


@dataclass
class MemoryTable:
    """One table: its key (``(partition, sort)`` or ``(partition,)``), its GSIs by name, its rows and the reads made."""

    table_name: str
    key: tuple[str, ...]
    indexes: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    rows: dict[tuple[Any, ...], dict[str, Any]] = field(default_factory=dict)
    reads: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    partitions: dict[Any, dict[tuple[Any, ...], dict[str, Any]]] = field(default_factory=dict)
    """The rows by table partition value, so a table query reads only its partition."""

    @property
    def name(self) -> str:
        return self.table_name

    def _row_key(self, item: Mapping[str, Any]) -> tuple[Any, ...]:
        return tuple(item[name] for name in self.key)

    def put_item(self, Item: Mapping[str, Any], **_conditions: Any) -> dict[str, Any]:
        item = stored(Item)
        key = self._row_key(item)
        self.rows[key] = item
        self.partitions.setdefault(key[0], {})[key] = item
        return {}

    def delete_item(self, Key: Mapping[str, Any], **_conditions: Any) -> dict[str, Any]:
        key = self._row_key(stored(Key))
        self.rows.pop(key, None)
        self.partitions.get(key[0], {}).pop(key, None)
        return {}

    def get_item(self, Key: Mapping[str, Any], **params: Any) -> dict[str, Any]:
        self.reads.append(('get_item', dict(Key)))
        row = self.rows.get(self._row_key(stored(Key)))
        return {} if row is None else {'Item': project(row, params)}

    @contextmanager
    def batch_writer(self, **_options: Any) -> Generator[MemoryTable]:
        yield self

    def put_rows(self, rows: Sequence[Mapping[str, Any]]) -> None:
        for row in rows:
            self.put_item(Item=row)

    def _schema(self, index_name: str | None) -> tuple[str, ...]:
        return self.key if index_name is None else self.indexes[index_name]

    def _page(self, rows: list[dict[str, Any]], params: Mapping[str, Any], key_names: Sequence[str]) -> dict[str, Any]:
        rows = rows_after(rows, stored(params.get('ExclusiveStartKey')), key_names)
        limit = min(int(params.get('Limit') or len(rows) or 1), PAGE_ROWS)
        page, rest = rows[:limit], rows[limit:]
        filtered = [row for row in page if params.get('FilterExpression') is None or matches(params['FilterExpression'], row)]
        response: dict[str, Any] = {'Count': len(filtered), 'ScannedCount': len(page)}
        if params.get('Select') != 'COUNT':
            response['Items'] = [project(row, params) for row in filtered]
        if rest and page:
            response['LastEvaluatedKey'] = {name: page[-1][name] for name in key_names if name in page[-1]}
        return response

    def query(self, **params: Any) -> dict[str, Any]:
        self.reads.append(('query', dict(params)))
        index_name = params.get('IndexName')
        schema = self._schema(index_name)
        candidates = self.rows.values() if index_name is not None else self._partition_rows(params['KeyConditionExpression'])
        rows = [row for row in candidates if all(name in row for name in schema) and matches(params['KeyConditionExpression'], row)]
        sort = schema[1] if len(schema) > 1 else None
        rows.sort(key=lambda row: (row.get(sort, '') if sort else '', self._row_key(row)), reverse=params.get('ScanIndexForward') is False)
        return self._page(rows, params, [*dict.fromkeys([*schema, *self.key])])

    def _partition_rows(self, condition: ConditionBase) -> Any:
        """The rows of the table partition ``condition`` names (every row when it names none)."""
        value = _partition_of(condition, self.key[0])
        return self.rows.values() if value is _ANY else self.partitions.get(stored(value), {}).values()

    def scan(self, **params: Any) -> dict[str, Any]:
        self.reads.append(('scan', dict(params)))
        rows = sorted(self.rows.values(), key=lambda row: tuple(str(part) for part in self._row_key(row)))
        if 'Segment' in params:
            rows = rows[int(params['Segment'])::int(params['TotalSegments'])]
        return self._page(rows, params, list(self.key))

    @property
    def meta(self) -> Any:
        table = self

        class _Client:
            def describe_table(self, TableName: str) -> dict[str, Any]:
                del TableName
                return {'Table': {'ItemCount': len(table.rows), 'TableSizeBytes': 1_000 * len(table.rows)}}

        class _Meta:
            client = _Client()

        return _Meta()


@dataclass
class MemoryDynamo:
    """A ``boto3.resource('dynamodb')`` over ``MemoryTable``s by name (an unknown name answers an empty table)."""

    tables: dict[str, MemoryTable] = field(default_factory=dict)

    def add(self, name: str, key: tuple[str, ...], indexes: Mapping[str, tuple[str, ...]] | None = None) -> MemoryTable:
        table = MemoryTable(name, key, dict(indexes or {}))
        self.tables[name] = table
        return table

    def Table(self, name: str) -> MemoryTable:
        if name not in self.tables:
            self.add(name, ('id',))
        return self.tables[name]

    def batch_get_item(self, RequestItems: Mapping[str, Mapping[str, Any]], **_options: Any) -> dict[str, Any]:
        responses: dict[str, list[dict[str, Any]]] = {}
        for name, request in RequestItems.items():
            table = self.Table(name)
            table.reads.append(('batch_get_item', {'keys': len(request['Keys'])}))
            found = (table.rows.get(table._row_key(stored(key))) for key in request['Keys'])
            responses[name] = [project(row, request) for row in found if row is not None]
        return {'Responses': responses, 'UnprocessedKeys': {}}

    def reads_of(self, name: str) -> list[tuple[str, dict[str, Any]]]:
        return list(self.Table(name).reads)

    def clear_reads(self) -> None:
        for table in self.tables.values():
            table.reads.clear()


__all__ = ['PAGE_ROWS', 'MemoryDynamo', 'MemoryTable', 'matches', 'stored']
