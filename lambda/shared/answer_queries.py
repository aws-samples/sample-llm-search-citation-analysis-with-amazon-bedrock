"""
Bounded reads of a keyword's SearchResults rows, projected to what an answer
(``shared.kpi_engine.answer_from_row``) is built from.

The sort key starts with the run timestamp (``<ts>#<provider>#<persona>``),
so a window, one run and the latest run are all key conditions: no read
walks a keyword's whole history.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.dynamodb_batch import collect_all_items
from shared.kpi_engine import ANSWER_ATTRIBUTE_NAMES, ANSWER_PROJECTION


def history_since(days: int, now: datetime | None = None) -> str:
    """The ISO timestamp ``days`` days before ``now``, in the run timestamps' format (a sort-key prefix)."""
    moment = (now or datetime.now(UTC)) - timedelta(days=days)
    return moment.strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def query_keyword_rows_since(table: Any, keyword: str, since: str) -> list[dict[str, Any]]:
    """Every projected row of ``keyword`` from ``since`` (an ISO timestamp) on."""
    return collect_all_items(
        table.query,
        KeyConditionExpression=Key('keyword').eq(keyword) & Key('timestamp_provider').gte(since),
        ProjectionExpression=ANSWER_PROJECTION,
        ExpressionAttributeNames=ANSWER_ATTRIBUTE_NAMES,
    )


def query_keyword_run_rows(table: Any, keyword: str, timestamp: str) -> list[dict[str, Any]]:
    """Every projected row of ``keyword`` in the run stamped ``timestamp``."""
    return collect_all_items(
        table.query,
        KeyConditionExpression=Key('keyword').eq(keyword) & Key('timestamp_provider').begins_with(f'{timestamp}#'),
        ProjectionExpression=ANSWER_PROJECTION,
        ExpressionAttributeNames=ANSWER_ATTRIBUTE_NAMES,
    )


def _newest_timestamp(table: Any, key_condition: Any) -> str | None:
    """The run timestamp of the newest row matching ``key_condition``, or ``None``."""
    response = table.query(
        KeyConditionExpression=key_condition,
        ScanIndexForward=False,
        Limit=1,
        ProjectionExpression='#ts',
        ExpressionAttributeNames={'#ts': 'timestamp'},
    )
    items = response.get('Items') or []
    timestamp = items[0].get('timestamp') if items else None
    return timestamp if isinstance(timestamp, str) and timestamp else None


def latest_run_timestamp(table: Any, keyword: str) -> str | None:
    """The timestamp of ``keyword``'s latest run, or ``None`` when it was never analysed."""
    return _newest_timestamp(table, Key('keyword').eq(keyword))


def previous_run_timestamp(table: Any, keyword: str, before: str) -> str | None:
    """The timestamp of ``keyword``'s last run before the run stamped ``before``, or ``None``."""
    # Every sort key of the run `before` starts with `before#`, so `< before` is strictly earlier runs.
    return _newest_timestamp(table, Key('keyword').eq(keyword) & Key('timestamp_provider').lt(before))


def query_last_two_runs_rows(table: Any, keyword: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The projected rows of ``keyword``'s latest run and of the run before it (either may be empty)."""
    latest = latest_run_timestamp(table, keyword)
    if latest is None:
        return [], []
    previous = previous_run_timestamp(table, keyword, latest)
    previous_rows = [] if previous is None else query_keyword_run_rows(table, keyword, previous)
    return query_keyword_run_rows(table, keyword, latest), previous_rows


__all__ = [
    'history_since',
    'latest_run_timestamp',
    'previous_run_timestamp',
    'query_keyword_rows_since',
    'query_keyword_run_rows',
    'query_last_two_runs_rows',
]
