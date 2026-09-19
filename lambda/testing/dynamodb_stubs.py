"""``MagicMock`` stand-ins for the boto3 DynamoDB resource and its tables."""

from __future__ import annotations

from collections.abc import Mapping
from unittest.mock import MagicMock


def fake_table(**responses: object) -> MagicMock:
    """A ``Table`` whose named methods return the given payloads.

    ``fake_table(query={'Items': []})`` answers every ``query`` call with an
    empty page; methods not listed stay plain ``MagicMock`` attributes.
    """
    table = MagicMock()
    for method, response in responses.items():
        getattr(table, method).return_value = response
    return table


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
