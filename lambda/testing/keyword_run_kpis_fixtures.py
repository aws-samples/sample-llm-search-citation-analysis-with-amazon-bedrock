"""A ``CitationAnalysis-KeywordRunKpis`` table fake and rollup rows built from SearchResults rows.

``rollup_table`` pages like DynamoDB (``paged_search_results_table`` keyed by
``run_timestamp``), honours a projection without ``brands``, hands numbers
back as ``Decimal`` as boto3 does, and keeps what ``put_item`` writes in the
dict it was given, so a test reads back what a writer stored.
"""

from __future__ import annotations

import os
from collections.abc import Generator, Iterable, Mapping, Sequence
from contextlib import contextmanager
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, patch

from shared.keyword_run_kpis import BRANDS_PER_RUN, tally_item
from shared.kpi_engine import answers_from_rows
from shared.kpi_tally import run_tally
from testing.window_rows_fixtures import paged_search_results_table

ROLLUP_TABLE_NAME = 'test-keyword-run-kpis'
ROLLUP_ENV = {'DYNAMODB_TABLE_KEYWORD_RUN_KPIS': ROLLUP_TABLE_NAME}


def as_stored(item: Mapping[str, Any]) -> dict[str, Any]:
    """``item`` as DynamoDB hands it back: every int a ``Decimal``."""
    return {key: Decimal(value) if isinstance(value, int) else value for key, value in item.items()}


def rollup_items(
    rows_by_keyword: Mapping[str, Sequence[Mapping[str, Any]]], owned_domains: Iterable[str] = (), *, brand_cap: int | None = BRANDS_PER_RUN,
) -> dict[str, list[dict[str, Any]]]:
    """Each keyword's rollup rows, one per run of its SearchResults rows, as the workflow writes them."""
    domains = list(owned_domains)
    items: dict[str, list[dict[str, Any]]] = {}
    for keyword, rows in rows_by_keyword.items():
        answers = answers_from_rows(rows)
        timestamps = sorted({answer.timestamp for answer in answers if answer.timestamp})
        items[keyword] = [
            as_stored(tally_item(run_tally(keyword, timestamp, [a for a in answers if a.timestamp == timestamp], domains, brand_cap=brand_cap)))
            for timestamp in timestamps
        ]
    return items


def rollup_table(items_by_keyword: dict[str, list[dict[str, Any]]], page_size: int = 50) -> MagicMock:
    """A KeywordRunKpis ``Table`` over ``items_by_keyword``; ``put_item`` replaces or adds a row there."""
    table = paged_search_results_table(items_by_keyword, page_size, sort_key='run_timestamp')
    paged_query = table.query.side_effect

    def query(**kwargs: Any) -> dict[str, Any]:
        response = paged_query(**kwargs)
        if 'brands' not in str(kwargs.get('ProjectionExpression') or 'brands'):
            response['Items'] = [{key: value for key, value in item.items() if key not in {'brands', 'brands_total'}} for item in response['Items']]
        return response

    def put_item(**kwargs: Any) -> dict[str, Any]:
        item = kwargs['Item']
        rows = items_by_keyword.setdefault(str(item['keyword']), [])
        rows[:] = [row for row in rows if row['run_timestamp'] != item['run_timestamp']] + [as_stored(item)]
        return {}

    table.query.side_effect = query
    table.put_item.side_effect = put_item
    return table


@contextmanager
def rollups_deployed() -> Generator[None]:
    """``DYNAMODB_TABLE_KEYWORD_RUN_KPIS`` is set for the block: readers and writers use the rollup table."""
    with patch.dict(os.environ, ROLLUP_ENV):
        yield
