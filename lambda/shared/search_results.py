"""
Reads of the SearchResults table that the per-keyword report endpoints share.

Every row of ``CitationAnalysis-SearchResults`` is one provider's answer for one
keyword in one analysis run (partition key ``keyword``, sort key
``timestamp_provider``). The endpoints that explain a keyword's current state
(brand mentions, persona rankings, the competitor rollup, self-reflection,
prompt insights) all begin the same way: list the keyword partitions to read,
read one partition, keep the rows of its newest run. Each step used to be
copied into every handler; this module is the single copy.

boto3 types every attribute of a returned item as a wide union
(``str | Decimal | set | list | ...``). The handlers know the table's schema,
so rows are handed back as ``dict[str, Any]`` here, at the read boundary, and
the callers stay free of per-field narrowing.
"""

from __future__ import annotations

import os
from typing import Any

from boto3.dynamodb.conditions import Key

# One projected Scan page is enough to enumerate a small Keywords table; the cap
# keeps a large table from turning the call into a full-table read.
DEFAULT_KEYWORD_SCAN_LIMIT = 500

# Rows read per keyword to isolate its latest run. One run writes one row per
# provider x persona (9 providers x a handful of personas today), so 50
# comfortably covers a full run while keeping the read small.
LATEST_RUN_ITEM_LIMIT = 50

# What ``query_latest_run`` reads of each row: never the answer text.
LATEST_RUN_PROJECTION = '#ts, provider, citations, brands'


def search_results_table_name() -> str:
    """The SearchResults table, from the required ``DYNAMODB_TABLE_SEARCH_RESULTS`` variable."""
    return os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']


def scan_keyword_texts(table: Any, limit: int = DEFAULT_KEYWORD_SCAN_LIMIT) -> list[str]:
    """The ``keyword`` of up to ``limit`` rows of ``table``, read as one projected Scan page.

    Lists the partitions a report fans out over: normally the Keywords table,
    or SearchResults itself where a handler falls back to it. Rows without a
    keyword are skipped.
    """
    response = table.scan(ProjectionExpression='keyword', Limit=limit)
    items: list[dict[str, Any]] = response.get('Items', [])
    return [item['keyword'] for item in items if item.get('keyword')]


def latest_run(items: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """The newest ``timestamp`` among ``items`` and the rows stamped with it (one per provider).

    A row without a timestamp sorts as ``''`` and is never part of the run
    (``''`` is not a stored value); no stamped rows at all give ``('', [])``.
    """
    latest = max((item.get('timestamp', '') for item in items), default='')
    return latest, [item for item in items if item.get('timestamp') == latest]


def query_latest_run(table: Any, keyword: str) -> tuple[str, list[dict[str, Any]]]:
    """``latest_run`` of ``keyword``'s newest ``LATEST_RUN_ITEM_LIMIT`` rows, read as one projected page.

    The projection (``LATEST_RUN_PROJECTION``) never includes the answer text.
    A keyword without rows gives ``('', [])``.
    """
    response = table.query(
        KeyConditionExpression=Key('keyword').eq(keyword),
        ScanIndexForward=False,
        Limit=LATEST_RUN_ITEM_LIMIT,
        ProjectionExpression=LATEST_RUN_PROJECTION,
        ExpressionAttributeNames={'#ts': 'timestamp'},
    )
    return latest_run(response.get('Items', []))
