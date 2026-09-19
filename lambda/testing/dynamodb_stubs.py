"""``MagicMock`` stand-ins for the boto3 DynamoDB resource and its tables."""

from __future__ import annotations

from collections.abc import Mapping
from unittest.mock import MagicMock

from botocore.exceptions import ClientError


def conditional_check_failure(operation: str = 'UpdateItem', *, message: str = 'The conditional request failed') -> ClientError:
    """The ``ClientError`` DynamoDB raises when a ``ConditionExpression`` rejects ``operation``.

    Hand it to a table stub's ``side_effect`` to simulate a lost write race;
    ``message`` only labels the scenario, handlers branch on the error code.
    """
    return ClientError({'Error': {'Code': 'ConditionalCheckFailedException', 'Message': message}}, operation)


def fake_table(**responses: object) -> MagicMock:
    """A ``Table`` whose named methods return the given payloads.

    ``fake_table(query={'Items': []})`` answers every ``query`` call with an
    empty page; methods not listed stay plain ``MagicMock`` attributes.
    """
    table = MagicMock()
    for method, response in responses.items():
        getattr(table, method).return_value = response
    return table


def reset_tables(*tables: MagicMock) -> None:
    """Forget every recorded call and configured response on the given table stubs.

    Meant for an ``autouse`` fixture in modules that share module-level table
    mocks across tests, so one test's ``side_effect`` cannot leak into the next.
    """
    for table in tables:
        table.reset_mock(side_effect=True, return_value=True)


def fake_dynamodb_resource(
    default_table: MagicMock | None = None,
    *,
    by_name: Mapping[str, MagicMock] | None = None,
) -> MagicMock:
    """A ``boto3.resource('dynamodb')`` whose ``Table(name)`` hands out the stubs above.

    Names listed in ``by_name`` get their own table; every other name falls back
    to ``default_table`` (a fresh ``MagicMock`` when omitted), so a handler that
    opens several tables can be pointed at one stub per table while the rest
    stay inert.
    """
    fallback = MagicMock() if default_table is None else default_table
    tables = dict(by_name or {})
    resource = MagicMock()
    resource.Table.side_effect = lambda name: tables.get(name, fallback)
    return resource
