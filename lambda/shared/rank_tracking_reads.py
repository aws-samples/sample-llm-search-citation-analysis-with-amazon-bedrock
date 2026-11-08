"""Rank tracking reads: trackers, runs, latest results with a comparison, keyword history and trend.

- Latest results: per keyword and device, the newest stored result (``STATE#`` items, so a newer failed run
  never erases it), compared with the baseline run: the newest finished (``completed`` or ``partial``) run that
  started at or before ``now - period``, else the earliest finished run. A keyword or device without a result
  is ``not_checked``, which is not the same as checked and not found.
- History: one keyword's results over at most ``MAX_HISTORY_DAYS`` days, oldest first.
- Trend: the buckets of every finished, non-subset run started in the window (filtered on the run's start, so
  a run spanning the cutoff keeps all its results).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.dynamo_decimal import plain
from shared.dynamodb_batch import collect_all_items
from shared.rank_tracking_runs import history_key, latest_run, list_runs, load_pairs, load_states
from shared.rank_tracking_schedule import format_timestamp
from shared.rank_tracking_store import MAX_KEYWORDS, KeywordSelection, TrackedKeyword, Tracker, device_list, tracker_pk

__all__ = [
    'FINISHED_STATUSES',
    'MAX_HISTORY_DAYS',
    'PERIOD_DAYS',
    'baseline_run',
    'history',
    'latest_run_json',
    'results',
    'run_json',
    'tracker_json',
    'trend',
]

PERIOD_DAYS = {'1d': 1, '7d': 7, '30d': 30, '90d': 90}
MAX_HISTORY_DAYS = 365
FINISHED_STATUSES = ('completed', 'partial')
RUN_FIELDS = ('run_id', 'status', 'trigger', 'method', 'keywords_total', 'keywords_checked', 'error_code',
              'error_message', 'started_at', 'completed_at')


def run_json(run: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """The API ``RankRun`` of a run item."""
    if run is None:
        return None
    body = {field: run.get(field) for field in RUN_FIELDS}
    body['is_subset'] = bool(run.get('is_subset'))
    body['devices'] = list(run.get('devices') or [])
    checked = run.get('checked')
    body['checked'] = dict(checked) if isinstance(checked, Mapping) else {}
    body['keywords_total'] = int(run.get('keywords_total') or 0)
    body['keywords_checked'] = int(run.get('keywords_checked') or 0)
    return body


def tracker_json(tracker: Tracker, selection: KeywordSelection, run: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """The API ``RankTracker``; its keyword counts are those of ``selection`` (``select_run_keywords``).

    ``keyword_count`` is what a run checks (at most ``MAX_KEYWORDS``), ``scope_keyword_count`` how many distinct
    keywords the scope and the extra keywords hold (more than ``max_keywords`` when the cap skips some).
    """
    return {
        'tracker_id': tracker.tracker_id,
        'domain': tracker.domain,
        'market_id': tracker.market_id,
        'devices': tracker.devices,
        'depth': tracker.depth,
        'schedule': tracker.schedule,
        'keyword_scope': tracker.keyword_scope,
        'group_id': tracker.group_id,
        'keyword_count': len(selection.keywords),
        'scope_keyword_count': selection.total,
        'extra_keyword_count': tracker.keyword_count,
        'max_keywords': MAX_KEYWORDS,
        'is_active': tracker.is_active,
        'next_check_at': tracker.next_check_at,
        'last_checked_at': tracker.last_checked_at,
        'last_skip_reason': tracker.last_skip_reason,
        'created_at': tracker.created_at,
        'updated_at': tracker.updated_at,
        'latest_run': run_json(run),
    }


def _finished_run(table: Any, tracker_id: str, upper: str, forward: bool) -> dict[str, Any] | None:
    """The first finished run (newest when ``forward`` is false) whose sort key is at most ``upper``."""
    params: dict[str, Any] = {
        'KeyConditionExpression': Key('pk').eq(tracker_pk(tracker_id)) & Key('sk').between('RUN#', upper),
        'ScanIndexForward': forward,
    }
    while True:
        page = table.query(**params)
        for item in page.get('Items') or []:
            if item.get('status') in FINISHED_STATUSES:
                return plain(item)
        if not page.get('LastEvaluatedKey'):
            return None
        params['ExclusiveStartKey'] = page['LastEvaluatedKey']


def baseline_run(table: Any, tracker_id: str, cutoff: datetime) -> dict[str, Any] | None:
    """The newest finished run started at or before ``cutoff``, else the earliest finished run."""
    upper = f"RUN#{cutoff.strftime('%Y%m%dT%H%M%SZ')}~"
    return _finished_run(table, tracker_id, upper, False) or _finished_run(table, tracker_id, 'RUN#~', True)


def _baseline_positions(table: Any, run: Mapping[str, Any] | None) -> dict[tuple[str, str], int | None]:
    if run is None:
        return {}
    positions: dict[tuple[str, str], int | None] = {}
    for pair in load_pairs(table, str(run['run_id'])):
        if pair.get('result_status'):
            position = pair.get('position')
            positions[(str(pair['keyword_id']), str(pair['device']))] = position if isinstance(position, int) else None
    return positions


def _cell(latest: object, previous: int | None) -> dict[str, Any]:
    if not isinstance(latest, Mapping):
        return {'status': 'not_checked', 'position': None, 'previous_position': previous, 'rank_absolute': None,
                'url': None, 'serp_features': [], 'checked_at': None}
    return {
        'status': latest.get('status') or 'not_checked',
        'position': latest.get('position'),
        'previous_position': previous,
        'rank_absolute': latest.get('rank_absolute'),
        'url': latest.get('url'),
        'serp_features': list(latest.get('serp_features') or []),
        'checked_at': latest.get('checked_at'),
    }


def results(table: Any, tracker: Tracker, keywords: Sequence[TrackedKeyword], period: str,
            now: datetime) -> dict[str, Any]:
    """The latest results of the tracker's current keywords, compared with ``period`` ago."""
    states = load_states(table, tracker.tracker_id)
    baseline = baseline_run(table, tracker.tracker_id, now - timedelta(days=PERIOD_DAYS[period]))
    previous = _baseline_positions(table, baseline)
    devices = device_list(tracker.devices)
    rows = []
    for keyword in keywords:
        state = states.get(keyword.keyword_id) or {}
        row: dict[str, Any] = {'keyword_id': keyword.keyword_id, 'keyword': keyword.keyword, 'source': keyword.source}
        for device in ('desktop', 'mobile'):
            row[device] = _cell(state.get(device), previous.get((keyword.keyword_id, device))) if device in devices else None
        rows.append(row)
    return {
        'tracker_id': tracker.tracker_id,
        'period': period,
        'devices': devices,
        'baseline_run_id': baseline['run_id'] if baseline else None,
        'baseline_started_at': baseline.get('started_at') if baseline else None,
        'rows': rows,
    }


def history(table: Any, tracker_id: str, keyword_id: str, days: int, now: datetime) -> list[dict[str, Any]]:
    """One keyword's results since ``days`` ago, oldest first."""
    since = format_timestamp(now - timedelta(days=min(days, MAX_HISTORY_DAYS)))
    items = collect_all_items(
        table.query, IndexName='GSI1',
        KeyConditionExpression=Key('gsi1pk').eq(history_key(tracker_id, keyword_id)) & Key('gsi1sk').gte(since),
    )
    return [
        {'device': item.get('device'), 'checked_at': item.get('checked_at'), 'position': item.get('position'),
         'status': item.get('result_status'), 'url': item.get('url')}
        for item in map(plain, items)
    ]


def trend(table: Any, tracker_id: str, days: int, now: datetime) -> list[dict[str, Any]]:
    """Per finished non-subset run and device: the position buckets."""
    points: list[dict[str, Any]] = []
    for run in list_runs(table, tracker_id, now - timedelta(days=min(days, MAX_HISTORY_DAYS))):
        summary = run.get('summary')
        if run.get('status') not in FINISHED_STATUSES or run.get('is_subset') or not isinstance(summary, Mapping):
            continue
        for device, buckets in summary.items():
            points.append({'run_id': run['run_id'], 'started_at': run['started_at'], 'device': device,
                           'total': int(run.get('keywords_total') or 0), **buckets})
    return points


def latest_run_json(table: Any, tracker_id: str) -> dict[str, Any] | None:
    return run_json(latest_run(table, tracker_id))
