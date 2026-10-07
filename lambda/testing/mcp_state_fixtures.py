"""An in-memory stand-in for the MCP state table (``lambda/mcp/state.py``).

``FakeStateTable`` keeps items by ``(pk, sk)`` and honours exactly the
condition and update expressions ``state.py`` sends, so tests observe real
single-use, counter and lock behaviour without DynamoDB. An expression it
does not know raises ``NotImplementedError``: a new expression in
``state.py`` needs a matching entry here.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from typing import Any

from testing.dynamodb_stubs import conditional_check_failure

Item = dict[str, Any]
Values = Mapping[str, Any]

_CONDITIONS: dict[str, Callable[[Item | None, Values], bool]] = {
    'attribute_exists(pk)': lambda item, _values: item is not None,
    'attribute_not_exists(pk) OR expires_at < :now':
        lambda item, values: item is None or item['expires_at'] < values[':now'],
    'attribute_not_exists(used) OR used < :limit':
        lambda item, values: item is None or 'used' not in item or item['used'] < values[':limit'],
    'used > :zero': lambda item, values: item is not None and item.get('used', 0) > values[':zero'],
}
_ADD = re.compile(r'ADD (\S+) (:\w+)')
_SET = re.compile(r'(\S+) = (:\w+)')


def _key(key: Mapping[str, str]) -> tuple[str, str]:
    return key['pk'], key['sk']


class FakeStateTable:
    """The subset of a boto3 ``Table`` the MCP state module uses."""

    def __init__(self) -> None:
        self.items: dict[tuple[str, str], Item] = {}

    def _check(self, expression: str | None, item: Item | None, values: Values | None, operation: str) -> None:
        if expression is None:
            return
        if expression not in _CONDITIONS:
            raise NotImplementedError(expression)
        if not _CONDITIONS[expression](item, values or {}):
            raise conditional_check_failure(operation)

    def put_item(self, Item: Item, ConditionExpression: str | None = None, ExpressionAttributeValues: Values | None = None) -> Item:
        key = _key(Item)
        self._check(ConditionExpression, self.items.get(key), ExpressionAttributeValues, 'PutItem')
        self.items[key] = dict(Item)
        return {}

    def get_item(self, Key: Mapping[str, str], **_read_options: Any) -> Item:
        item = self.items.get(_key(Key))
        return {'Item': dict(item)} if item is not None else {}

    def delete_item(self, Key: Mapping[str, str], ConditionExpression: str | None = None) -> Item:
        key = _key(Key)
        self._check(ConditionExpression, self.items.get(key), None, 'DeleteItem')
        self.items.pop(key, None)
        return {}

    def update_item(
        self,
        Key: Mapping[str, str],
        UpdateExpression: str,
        ConditionExpression: str | None = None,
        ExpressionAttributeNames: Mapping[str, str] | None = None,
        ExpressionAttributeValues: Values | None = None,
    ) -> Item:
        key = _key(Key)
        values = ExpressionAttributeValues or {}
        names = ExpressionAttributeNames or {}
        self._check(ConditionExpression, self.items.get(key), values, 'UpdateItem')
        item = self.items.setdefault(key, {'pk': key[0], 'sk': key[1]})
        add_clause, _, set_clause = UpdateExpression.partition('SET ')
        for name, value in _ADD.findall(add_clause):
            item[name] = item.get(name, 0) + values[value]
        for name, value in _SET.findall(set_clause):
            attribute = str(name)
            item[names.get(attribute, attribute)] = values[value]
        return {}

    def query(self, KeyConditionExpression: Any, ScanIndexForward: bool = True, Limit: int | None = None) -> Item:
        partition = KeyConditionExpression.get_expression()['values'][1]
        items = sorted((item for (pk, _sk), item in self.items.items() if pk == partition), key=lambda item: item['sk'])
        if not ScanIndexForward:
            items.reverse()
        return {'Items': [dict(item) for item in items[:Limit]]}

    def partition(self, pk: str) -> list[Item]:
        """Every stored item of partition ``pk``, in sort-key order."""
        return [item for (item_pk, _sk), item in sorted(self.items.items()) if item_pk == pk]


def install_fake_table(monkeypatch: Any) -> FakeStateTable:
    """A fresh ``FakeStateTable`` as the table ``state.table()`` hands out, for the test's duration."""
    fake = FakeStateTable()
    monkeypatch.setattr('state._table', fake)
    return fake
