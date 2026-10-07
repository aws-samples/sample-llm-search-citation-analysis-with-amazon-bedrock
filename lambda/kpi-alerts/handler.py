"""Post-run KPI snapshot and alert worker.

The state machine catches every failure from this Lambda, so analysis reports
remain successful even when alert evaluation is unavailable.

The report in the payload is GenerateSummary's compact one; the per-keyword
run identity is read back from the full report at its ``s3_location``.
Executions started before scope-only trigger inputs carry ``requested_scope``
next to (or instead of) ``scope``; both are honoured.

A completed evaluation names the run (``run_timestamp``) and the groups it
snapshotted (``snapshot_group_ids``): exactly the groups the run fully
covers, for which the GenerateInsights step writes a narrative.
"""

from __future__ import annotations

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from shared.answer_queries import query_keyword_run_rows
from shared.dynamo_decimal import convert_floats_to_decimal
from shared.dynamodb_batch import collect_all_items
from shared.dynamodb_conditions import applied_conditionally
from shared.keyword_groups import keyword_group_ids, query_active_keywords
from shared.kpi_alerts import (
    build_alert_item,
    compare_snapshots,
    resolve_settings,
    snapshot_metrics,
    ttl_for_timestamp,
)
from shared.kpi_engine import Answer, answers_from_rows, owned_domains_from
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_MAX_WORKERS = 10

SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = os.environ['DYNAMODB_TABLE_KEYWORDS']
KEYWORD_GROUPS_TABLE = os.environ['DYNAMODB_TABLE_KEYWORD_GROUPS']
BRAND_CONFIG_TABLE = os.environ['DYNAMODB_TABLE_BRAND_CONFIG']
SNAPSHOTS_TABLE = os.environ['DYNAMODB_TABLE_KPI_SNAPSHOTS']
ALERTS_TABLE = os.environ['DYNAMODB_TABLE_KPI_ALERTS']
SETTINGS_TABLE = os.environ['DYNAMODB_TABLE_ALERT_SETTINGS']
CONTENT_CHANGES_TABLE = os.environ['DYNAMODB_TABLE_CONTENT_CHANGES']
ALERTS_TOPIC_ARN = os.environ['KPI_ALERTS_TOPIC_ARN']

dynamodb = boto3.resource('dynamodb', config=Config(max_pool_connections=50))
sns = boto3.client('sns')
s3 = boto3.client('s3')


def _skipped(reason: str | None) -> dict[str, Any]:
    return {
        'status': 'skipped',
        'reason': reason,
        'groups_evaluated': 0,
        'snapshots_recorded': 0,
        'alerts_created': 0,
        'skipped_partial': 0,
    }


def _parse_s3_uri(value: Any) -> tuple[str, str] | None:
    if not isinstance(value, str) or not value.startswith('s3://'):
        return None
    bucket, _, key = value.removeprefix('s3://').partition('/')
    return (bucket, key) if bucket and key else None


def _full_report(report: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """The report with its per-keyword lists: ``(report, None)`` or ``(None, skip reason)``.

    GenerateSummary returns a compact report (the keyword lists would outgrow
    the state for large runs) and stores the full one at ``s3_location``. A
    report that already carries ``run_metadata.processed_keywords`` (older
    executions, direct invocations) or that is not comparable anyway is used
    as-is. A missing or unreadable S3 report skips the evaluation; it never
    fails the run.
    """
    metadata = report.get('run_metadata')
    if report.get('status') != 'completed' or (isinstance(metadata, dict) and 'processed_keywords' in metadata):
        return report, None
    location = _parse_s3_uri(report.get('s3_location'))
    if location is None:
        return None, 'full_report_location_missing'
    bucket, key = location
    try:
        full = json.loads(s3.get_object(Bucket=bucket, Key=key)['Body'].read())
    except (BotoCoreError, ClientError, ValueError):
        logger.exception('Full execution report could not be read from S3')
        return None, 'full_report_unreadable'
    if not isinstance(full, dict):
        return None, 'full_report_unreadable'
    return full, None


def _load_groups() -> list[dict[str, Any]]:
    return collect_all_items(
        dynamodb.Table(KEYWORD_GROUPS_TABLE).scan,
        ProjectionExpression='id, #name',
        ExpressionAttributeNames={'#name': 'name'},
    )


def _run_identity(report: Any) -> tuple[str | None, list[str], str | None]:
    if not isinstance(report, dict) or report.get('status') != 'completed':
        return None, [], 'report_not_comparable'
    metadata = report.get('run_metadata')
    if not isinstance(metadata, dict):
        return None, [], 'run_timestamp_missing_or_ambiguous'
    timestamp = metadata.get('timestamp')
    timestamps = metadata.get('timestamps')
    processed = metadata.get('processed_keywords')
    if (
        not isinstance(timestamp, str)
        or not timestamp
        or timestamps != [timestamp]
        or not isinstance(processed, list)
    ):
        return None, [], 'run_timestamp_missing_or_ambiguous'

    names: list[str] = []
    for item in processed:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get('keyword'), str)
            or not item['keyword']
            or item.get('timestamp') != timestamp
        ):
            return None, [], 'run_timestamp_missing_or_ambiguous'
        names.append(item['keyword'])
    if not names:
        return None, [], 'run_timestamp_missing_or_ambiguous'
    return timestamp, names, None


def _scope_group_ids(
    execution_input: dict[str, Any],
    active_keywords: list[dict[str, Any]],
    all_group_ids: set[str],
) -> set[str]:
    selected: set[str] = set()
    all_groups = execution_input.get('source') == 'dynamodb'
    active_by_id = {str(item.get('id')): item for item in active_keywords if item.get('id')}

    for field in ('scope', 'requested_scope'):
        scope = execution_input.get(field)
        if not isinstance(scope, dict):
            continue
        mode = scope.get('mode')
        if mode == 'all':
            all_groups = True
        elif mode == 'groups':
            selected.update(str(value) for value in scope.get('group_ids', []) if value)
        elif mode == 'keywords':
            for keyword_id in scope.get('keyword_ids', []):
                item = active_by_id.get(str(keyword_id))
                if item is not None:
                    selected.update(keyword_group_ids(item))

    return all_group_ids if all_groups else selected


def _touched_groups(
    execution_input: dict[str, Any],
    processed_names: list[str],
    active_keywords: list[dict[str, Any]],
    groups: list[dict[str, Any]],
) -> set[str]:
    all_group_ids = {str(group.get('id')) for group in groups if group.get('id')}
    selected = _scope_group_ids(execution_input, active_keywords, all_group_ids)
    processed = set(processed_names)
    for item in active_keywords:
        if item.get('keyword') in processed:
            selected.update(keyword_group_ids(item))
    return selected & all_group_ids


def _members_by_group(active_keywords: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    members: dict[str, list[dict[str, Any]]] = {}
    for item in active_keywords:
        for group_id in keyword_group_ids(item):
            members.setdefault(group_id, []).append(item)
    for rows in members.values():
        rows.sort(key=lambda item: str(item.get('keyword', '')).casefold())
    return members


def _complete_groups(
    touched: set[str],
    processed_names: list[str],
    members: dict[str, list[dict[str, Any]]],
) -> tuple[list[str], int]:
    processed = set(processed_names)
    complete: list[str] = []
    skipped = 0
    for group_id in sorted(touched):
        names = {
            str(item['keyword'])
            for item in members.get(group_id, [])
            if item.get('keyword')
        }
        if names and names <= processed:
            complete.append(group_id)
        else:
            skipped += 1
    return complete, skipped


def _load_run_answers(
    keywords: list[str],
    timestamp: str,
) -> dict[str, list[Answer] | None]:
    """Each keyword's answers in the run stamped ``timestamp``; ``None`` for a keyword that could not be read."""
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)

    def load(keyword: str) -> tuple[str, list[Answer] | None]:
        try:
            return keyword, answers_from_rows(query_keyword_run_rows(table, keyword, timestamp))
        except Exception:
            logger.exception('Exact-run answers query failed for one keyword')
            return keyword, None

    if not keywords:
        return {}
    workers = min(_MAX_WORKERS, len(keywords))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return dict(pool.map(load, keywords))


def _execution_metadata(
    execution_id: str,
    execution_input: dict[str, Any],
    report: dict[str, Any],
    run_timestamp: str,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        'execution_id': execution_id,
        'run_timestamp': run_timestamp,
        'report_timestamp': report.get('timestamp'),
    }
    for field in ('triggered_by', 'schedule_id', 'display_name', 'source'):
        value = execution_input.get(field)
        if isinstance(value, str) and value:
            result[field] = value
    for field in ('scope', 'requested_scope'):
        value = execution_input.get(field)
        if isinstance(value, dict):
            result[field] = value
    return result


def _snapshot(
    group_id: str,
    group_name: str,
    execution_id: str,
    execution_input: dict[str, Any],
    report: dict[str, Any],
    timestamp: str,
    metrics: dict[str, Any],
) -> dict[str, Any]:
    return {
        'group_id': group_id,
        'snapshot_at': timestamp,
        'group_name': group_name,
        'execution': _execution_metadata(
            execution_id,
            execution_input,
            report,
            timestamp,
        ),
        'complete_scope': True,
        **metrics,
        'ttl': ttl_for_timestamp(timestamp),
    }


def _previous_snapshot(group_id: str, timestamp: str) -> dict[str, Any] | None:
    response = dynamodb.Table(SNAPSHOTS_TABLE).query(
        KeyConditionExpression=(
            Key('group_id').eq(group_id)
            & Key('snapshot_at').lt(timestamp)
        ),
        ScanIndexForward=False,
        Limit=1,
    )
    items = response.get('Items', [])
    return items[0] if items else None


def _content_change(
    group_id: str,
    previous_timestamp: str,
    current_timestamp: str,
) -> dict[str, Any] | None:
    response = dynamodb.Table(CONTENT_CHANGES_TABLE).query(
        KeyConditionExpression=(
            Key('group_id').eq(group_id)
            & Key('changed_at').between(previous_timestamp, current_timestamp)
        ),
        ScanIndexForward=False,
        Limit=1,
    )
    items = response.get('Items', [])
    marker = items[0] if items else None
    if marker and marker.get('changed_at') == previous_timestamp:
        return None
    return marker


def _put_new_alert(item: dict[str, Any]) -> bool:
    return applied_conditionally(lambda: dynamodb.Table(ALERTS_TABLE).put_item(
        Item=convert_floats_to_decimal(item),
        ConditionExpression='attribute_not_exists(id)',
    ))


def _settings() -> dict[str, Any]:
    response = dynamodb.Table(SETTINGS_TABLE).get_item(Key={'config_id': 'default'})
    return resolve_settings(response.get('Item'))


def _message(alerts: list[dict[str, Any]], execution_id: str) -> str:
    visible = alerts[:20]
    lines = [
        f'Citation Analysis detected {len(alerts)} new KPI alert(s) for execution {execution_id}.',
        *[
            f"- [{item['severity'].upper()}] {' '.join(str(item['message']).split())}"
            for item in visible
        ],
    ]
    if len(alerts) > len(visible):
        lines.append(f'- {len(alerts) - len(visible)} additional alert(s) are available in the dashboard.')
    return '\n'.join(lines)


def _notify(alerts: list[dict[str, Any]], execution_id: str, settings: dict[str, Any]) -> dict[str, Any]:
    if not alerts:
        return {'status': 'not_sent', 'reason': 'no_new_alerts'}
    if not settings.get('enabled') or not settings.get('notification_emails'):
        return {'status': 'not_sent', 'reason': 'no_configured_emails'}
    try:
        sns.publish(
            TopicArn=ALERTS_TOPIC_ARN,
            Subject=f'Citation Analysis: {len(alerts)} new KPI alert(s)'[:100],
            Message=_message(alerts, execution_id),
        )
    except Exception:
        logger.exception('KPI alert notification publish failed')
        return {'status': 'failed'}
    return {'status': 'published'}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Evaluate one clean, unambiguous analysis run without selecting newer rows."""
    if not isinstance(event, dict):
        raise ValueError('KPI alert event must be an object')
    report = event.get('report')
    execution_input = event.get('execution_input')
    execution_id = event.get('execution_id')
    if not isinstance(report, dict) or not isinstance(execution_input, dict) or not isinstance(execution_id, str):
        raise ValueError('KPI alert event is missing required fields')

    report, report_error = _full_report(report)
    if report is None:
        return _skipped(report_error)

    run_timestamp, processed_names, reason = _run_identity(report)
    if reason is not None or run_timestamp is None:
        return _skipped(reason)

    active_keywords = query_active_keywords(dynamodb.Table(KEYWORDS_TABLE))
    groups = _load_groups()
    groups_by_id = {
        str(group['id']): group
        for group in groups
        if group.get('id')
    }
    members = _members_by_group(active_keywords)
    touched = _touched_groups(execution_input, processed_names, active_keywords, groups)
    complete, skipped_partial = _complete_groups(touched, processed_names, members)
    if not complete:
        return {
            'status': 'completed',
            'run_timestamp': run_timestamp,
            'groups_evaluated': 0,
            'snapshots_recorded': 0,
            'snapshot_group_ids': [],
            'alerts_created': 0,
            'skipped_partial': skipped_partial,
            'notification': {'status': 'not_sent', 'reason': 'no_new_alerts'},
        }
    unique_keywords = sorted({
        str(item['keyword'])
        for group_id in complete
        for item in members.get(group_id, [])
        if item.get('keyword')
    }, key=str.casefold)

    settings = _settings()
    owned_domains = owned_domains_from(get_brand_config(BRAND_CONFIG_TABLE))
    answers_by_keyword = _load_run_answers(unique_keywords, run_timestamp)

    # The groups snapshotted, in group id order: exactly the groups this run fully covers.
    snapshot_group_ids: list[str] = []
    groups_evaluated = 0
    new_alerts: list[dict[str, Any]] = []
    for group_id in complete:
        keywords = [str(item['keyword']) for item in members[group_id]]
        group_answers = {keyword: answers for keyword in keywords if (answers := answers_by_keyword[keyword])}
        # A keyword that could not be read, or that no engine answered, leaves the run incomplete.
        if len(group_answers) < len(keywords):
            skipped_partial += 1
            continue

        group = groups_by_id[group_id]
        snapshot = _snapshot(
            group_id,
            str(group.get('name') or group_id),
            execution_id,
            execution_input,
            report,
            run_timestamp,
            snapshot_metrics(group_answers, owned_domains),
        )
        previous = _previous_snapshot(group_id, run_timestamp)
        marker = (
            _content_change(group_id, str(previous['snapshot_at']), run_timestamp)
            if previous is not None and settings.get('enabled')
            else None
        )
        dynamodb.Table(SNAPSHOTS_TABLE).put_item(Item=convert_floats_to_decimal(snapshot))
        snapshot_group_ids.append(group_id)
        groups_evaluated += 1

        for specification in compare_snapshots(
            previous,
            snapshot,
            settings,
            content_change=marker,
        ):
            item = build_alert_item(
                specification,
                execution_id=execution_id,
                group_id=group_id,
                group_name=str(group.get('name') or group_id),
                created_at=run_timestamp,
                run_timestamp=run_timestamp,
            )
            if _put_new_alert(item):
                new_alerts.append(item)

    notification = _notify(new_alerts, execution_id, settings)
    return {
        'status': 'completed',
        'run_timestamp': run_timestamp,
        'groups_evaluated': groups_evaluated,
        'snapshots_recorded': len(snapshot_group_ids),
        'snapshot_group_ids': snapshot_group_ids,
        'alerts_created': len(new_alerts),
        'skipped_partial': skipped_partial,
        'notification': notification,
    }
