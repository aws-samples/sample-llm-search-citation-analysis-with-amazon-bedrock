"""
Bounded reads of a keyword's SearchResults rows, projected to what an answer
(``shared.kpi_engine.answer_from_row``) is built from.

The sort key starts with the run timestamp (``<ts>#<provider>#<persona>``),
so a window, one run and the latest run are all key conditions: no read
walks a keyword's whole history.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.dynamodb_batch import collect_all_items
from shared.kpi_engine import ANSWER_ATTRIBUTE_NAMES, ANSWER_PROJECTION
from shared.utils import format_timestamp


def history_since(days: int, now: datetime | None = None) -> str:
    """The ISO timestamp ``days`` days before ``now``, in the run timestamps' format (a sort-key prefix)."""
    return format_timestamp((now or datetime.now(UTC)) - timedelta(days=days))


def query_keyword_rows_since(table: Any, keyword: str, since: str) -> list[dict[str, Any]]:
    """Every projected row of ``keyword`` from ``since`` (an ISO timestamp) on."""
    return collect_all_items(
        table.query,
        KeyConditionExpression=Key('keyword').eq(keyword) & Key('timestamp_provider').gte(since),
        ProjectionExpression=ANSWER_PROJECTION,
        ExpressionAttributeNames=ANSWER_ATTRIBUTE_NAMES,
    )


@dataclass(frozen=True)
class CappedRows:
    """A keyword's projected rows of a window, oldest first, read newest first up to a row cap."""

    rows: list[dict[str, Any]]
    cut: str | None
    """``None`` when the window was read whole; else the run timestamp at and before which no row was kept."""


def _window_condition(keyword: str, since: str, until: str | None) -> Any:
    """The key condition of ``keyword``'s rows from ``since`` on, through the run ``until`` when given."""
    sort_key = Key('timestamp_provider')
    # Every sort key of the run `until` starts with `until#`, and '$' sorts right after '#'.
    window = sort_key.gte(since) if until is None else sort_key.between(since, f'{until}$')
    return Key('keyword').eq(keyword) & window


def query_keyword_rows_capped(
    table: Any,
    keyword: str,
    since: str,
    max_rows: int,
    *,
    until: str | None = None,
) -> CappedRows:
    """``keyword``'s projected rows from ``since`` on (through the run ``until``), at most ``max_rows`` of the newest.

    The window is read newest first, so a cap drops the oldest runs and never
    the latest. The oldest run read may be incomplete when the cap stops the
    read inside it, so all of its rows are dropped and its timestamp becomes
    ``cut``: the rows kept are every row of the runs after ``cut``.
    """
    params: dict[str, Any] = {
        'KeyConditionExpression': _window_condition(keyword, since, until),
        'ProjectionExpression': ANSWER_PROJECTION,
        'ExpressionAttributeNames': ANSWER_ATTRIBUTE_NAMES,
        'ScanIndexForward': False,
    }
    rows: list[dict[str, Any]] = []
    # One row past the cap tells "exactly max_rows" apart from "more than max_rows".
    while len(rows) <= max_rows:
        response = table.query(**params, Limit=max_rows + 1 - len(rows))
        rows.extend(response.get('Items') or [])
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            break
        params['ExclusiveStartKey'] = last_key
    rows.reverse()
    if len(rows) <= max_rows:
        return CappedRows(rows, None)
    cut = str(rows[0].get('timestamp') or '')
    return CappedRows([row for row in rows if str(row.get('timestamp') or '') > cut], cut)


def query_keyword_run_rows(
    table: Any,
    keyword: str,
    timestamp: str,
    *,
    projection: str = ANSWER_PROJECTION,
    attribute_names: Mapping[str, str] = ANSWER_ATTRIBUTE_NAMES,
) -> list[dict[str, Any]]:
    """Every row of ``keyword`` in the run stamped ``timestamp``, projected to an answer's attributes by default.

    ``projection`` / ``attribute_names`` widen the read for a caller that
    needs more than ``answer_from_row`` does (e.g. the answer text).
    """
    return collect_all_items(
        table.query,
        KeyConditionExpression=Key('keyword').eq(keyword) & Key('timestamp_provider').begins_with(f'{timestamp}#'),
        ProjectionExpression=projection,
        ExpressionAttributeNames=dict(attribute_names),
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


def query_latest_run_rows(
    table: Any,
    keyword: str,
    *,
    projection: str = ANSWER_PROJECTION,
    attribute_names: Mapping[str, str] = ANSWER_ATTRIBUTE_NAMES,
) -> list[dict[str, Any]]:
    """Every row of ``keyword``'s latest run (projected as ``query_keyword_run_rows``); none when it was never analysed."""
    latest = latest_run_timestamp(table, keyword)
    if latest is None:
        return []
    return query_keyword_run_rows(table, keyword, latest, projection=projection, attribute_names=attribute_names)


__all__ = [
    'CappedRows',
    'history_since',
    'latest_run_timestamp',
    'previous_run_timestamp',
    'query_keyword_rows_capped',
    'query_keyword_rows_since',
    'query_keyword_run_rows',
    'query_last_two_runs_rows',
    'query_latest_run_rows',
]
