"""Keywords, SearchResults rows and a DynamoDB fake for the scoped report endpoint tests.

``api/test_report_scopes.py`` drives ``/visibility``, ``/brand-mentions``,
``/citations``, ``/trends``, ``/citation-gaps`` and ``/reports/overview``
through one fake: the Keywords table lists ``ACTIVE_KEYWORDS`` and the
SearchResults partitions answer from ``SEARCH_ROWS`` honouring the sort-key
condition (``begins_with``, ``<``, ``>=``), ``ScanIndexForward`` and ``Limit``.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, patch

from testing.assertions import present
from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.module_loader import load_handler_module, module_name_for

# The tables the report handlers resolve at import (and CORS without an origin parameter).
REPORT_TABLES_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'CORS_ORIGIN_PARAM': '',
}

SCOPE_ENV: Mapping[str, str] = {
    **REPORT_TABLES_ENV,
    'DYNAMODB_TABLE_CITATIONS': 'test-citations',
    'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brand-config',
}

ACTIVE_KEYWORDS = [
    {'id': 'k1', 'keyword': 'hotel coruna spa', 'status': 'active', 'group_ids': {'coruna'}},
    {'id': 'k2', 'keyword': 'hotel marino beach', 'status': 'active', 'group_ids': {'marino'}},
    {'id': 'k3', 'keyword': 'best hotels galicia', 'status': 'active', 'group_ids': {'coruna', 'marino'}},
]

RUN_TS = '2026-09-18T10:00:00Z'
OLD_TS = '2026-09-10T10:00:00Z'


def load_scoped_handler(directory: str, filename: str, suffix: str = '_scopes') -> ModuleType:
    """``filename`` loaded with ``SCOPE_ENV`` in place and ``boto3.resource`` stubbed."""
    with patch('boto3.resource', MagicMock()), patch.dict(os.environ, SCOPE_ENV):
        return load_handler_module(directory, filename, module_name_for(filename, suffix))


def brand(name: str, classification: str, mentions: int = 1, rank: int = 1, sentiment: str = 'positive') -> dict[str, Any]:
    return {'name': name, 'classification': classification, 'mention_count': mentions, 'rank': rank, 'sentiment': sentiment}


def result(
    keyword: str,
    provider: str,
    brands: list[dict[str, Any]],
    timestamp: str = RUN_TS,
    citations: list[str] | None = None,
    model: str | None = None,
    query_prompt_id: str = 'default',
) -> dict[str, Any]:
    """One stored SearchResults row (with a long ``response`` the scoped reads must not project)."""
    return {
        'keyword': keyword, 'timestamp': timestamp, 'timestamp_provider': f'{timestamp}#{provider}#{query_prompt_id}',
        'provider': provider, 'brands': brands, 'response': 'long llm text ' * 50, 'citations': citations or [],
        'metadata': {'model': model or f'{provider}-model'}, 'query_prompt_id': query_prompt_id,
    }


SEARCH_ROWS = {
    'hotel coruna spa': [
        result('hotel coruna spa', 'openai', [brand('Hotel Coruna', 'first_party', 2, 1), brand('Rival Inn', 'competitor', 1, 2)]),
        result('hotel coruna spa', 'gemini', [brand('Hotel Coruna', 'first_party', 1, 1)]),
        result('hotel coruna spa', 'openai', [brand('Rival Inn', 'competitor', 5, 1)], timestamp=OLD_TS),
    ],
    'best hotels galicia': [
        result('best hotels galicia', 'openai', [brand('Rival Inn', 'competitor', 3, 1)]),
    ],
    'hotel marino beach': [],
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


def fake_scope_dynamodb(
    search_rows: Mapping[str, list[dict[str, Any]]] = SEARCH_ROWS,
    citation_rows: Mapping[str, list[dict[str, Any]]] | None = None,
    active: list[dict[str, Any]] = ACTIVE_KEYWORDS,
) -> tuple[MagicMock, dict[str, MagicMock]]:
    """A boto3 resource whose tables answer from the fixtures above, and those tables by role."""
    keywords_table = MagicMock(name='keywords')
    keywords_table.query.return_value = {'Items': active}

    def search_query(**kwargs: Any) -> dict[str, Any]:
        keyword, sort = key_parts(kwargs['KeyConditionExpression'])
        rows = [row for row in search_rows.get(keyword, []) if _sort_key_matches(row, sort)]
        if kwargs.get('ScanIndexForward') is False:
            rows.sort(key=lambda row: row['timestamp_provider'], reverse=True)
        return {'Items': rows[:kwargs['Limit']] if 'Limit' in kwargs else rows}

    search_table = MagicMock(name='search')
    search_table.query.side_effect = search_query

    citations = citation_rows or {}
    citations_table = MagicMock(name='citations')
    citations_table.query.side_effect = lambda **kwargs: {'Items': list(citations.get(key_parts(kwargs['KeyConditionExpression'])[0], []))}
    citations_table.scan.return_value = {'Items': [row for rows in citations.values() for row in rows]}

    tables = {'keywords': keywords_table, 'search': search_table, 'citations': citations_table}
    resource = fake_dynamodb_resource(by_name={
        'test-keywords': keywords_table,
        'test-search-results': search_table,
        'test-citations': citations_table,
    })
    return resource, tables


def aggregated_brand(body: Mapping[str, Any], name: str) -> dict[str, Any]:
    """The ``/brand-mentions`` aggregate entry of the brand called ``name``."""
    return next(entry for entry in body['aggregated']['brands'] if entry['name'] == name)


class PartitionFailure(Exception):
    """A SearchResults partition that cannot be read."""


def fail_reads_of(search_table: MagicMock, keyword: str) -> None:
    """Make every read of ``keyword``'s SearchResults partition raise, keeping the others answering."""
    succeed = search_table.query.side_effect

    def search_query(**kwargs: Any) -> dict[str, Any]:
        if key_parts(kwargs['KeyConditionExpression'])[0] == keyword:
            raise PartitionFailure('throttled')
        return succeed(**kwargs)

    search_table.query.side_effect = search_query


def scope_event(params: Mapping[str, str] | None) -> dict[str, Any]:
    return {'httpMethod': 'GET', 'path': '/api/x', 'queryStringParameters': params, 'headers': {}}


@dataclass(frozen=True)
class ScopedReport:
    """A report handler wired to the fake tables: call it with query parameters."""

    module: ModuleType
    tables: dict[str, MagicMock]

    def call(self, params: Mapping[str, str] | None) -> dict[str, Any]:
        """The raw proxy response to ``GET`` with ``params``."""
        return self.module.handler(scope_event(params), None)

    def body(self, params: Mapping[str, str] | None) -> Any:
        """The decoded response body to ``GET`` with ``params``."""
        return json.loads(self.call(params)['body'])


@contextmanager
def scoped_report(
    module: ModuleType, brand_config: Mapping[str, Any] | None = None, **fake: Any,
) -> Iterator[ScopedReport]:
    """``module`` reading ``fake_scope_dynamodb(**fake)``, with ``get_brand_config`` answering ``brand_config``.

    ``brand_config=None`` leaves ``get_brand_config`` alone (for handlers that
    read the brands another way).
    """
    resource, tables = fake_scope_dynamodb(**fake)
    with patch.object(module, 'dynamodb', resource):
        if brand_config is None:
            yield ScopedReport(module, tables)
            return
        with patch.object(module, 'get_brand_config', return_value=brand_config):
            yield ScopedReport(module, tables)
