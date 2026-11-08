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

# Rows a page of ``query_latest_run`` reads. One run writes one row per
# provider x persona; a page this size holds most runs whole, and the read
# carries on page after page until it reaches an older run (2.45.0: a run
# of 9 providers x 10 personas is 90 rows, more than one page).
LATEST_RUN_ITEM_LIMIT = 50
#: Pages ``query_latest_run`` reads at most (a run is far smaller: providers x ``MAX_QUERY_PROMPTS_PER_RUN``).
LATEST_RUN_MAX_PAGES = 40

# What ``query_latest_run`` reads of each row: never the answer text.
LATEST_RUN_PROJECTION = '#ts, provider, citations, brands'


def search_results_table_name() -> str:
    """The SearchResults table, from the required ``DYNAMODB_TABLE_SEARCH_RESULTS`` variable."""
    return os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']



def latest_run(items: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """The newest ``timestamp`` among ``items`` and the rows stamped with it (one per provider).

    A row without a timestamp sorts as ``''`` and is never part of the run
    (``''`` is not a stored value); no stamped rows at all give ``('', [])``.
    """
    latest = max((item.get('timestamp', '') for item in items), default='')
    return latest, [item for item in items if item.get('timestamp') == latest]


def query_latest_run(table: Any, keyword: str) -> tuple[str, list[dict[str, Any]]]:
    """``latest_run`` of ``keyword``: every row of its newest run, read newest first in pages of ``LATEST_RUN_ITEM_LIMIT``.

    Pages are read until one reaches an older run (or the partition ends),
    so a run longer than a page is read whole. The projection
    (``LATEST_RUN_PROJECTION``) never includes the answer text. A keyword
    without rows gives ``('', [])``.
    """
    query: dict[str, Any] = {
        'KeyConditionExpression': Key('keyword').eq(keyword),
        'ScanIndexForward': False,
        'Limit': LATEST_RUN_ITEM_LIMIT,
        'ProjectionExpression': LATEST_RUN_PROJECTION,
        'ExpressionAttributeNames': {'#ts': 'timestamp'},
    }
    items: list[dict[str, Any]] = []
    for _ in range(LATEST_RUN_MAX_PAGES):
        response = table.query(**query)
        page = response.get('Items', [])
        items.extend(page)
        newest = items[0].get('timestamp') if items else None
        start_key = response.get('LastEvaluatedKey')
        if not start_key or any(item.get('timestamp') != newest for item in page):
            break
        query['ExclusiveStartKey'] = start_key
    return latest_run(items)
