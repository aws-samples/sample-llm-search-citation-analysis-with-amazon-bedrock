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

Snapshots and alerts are per (group, market) (2.37.0): the active keywords of
one group in one market (``shared.markets.keyword_market_id``) are compared
with that pair's previous snapshot. The global market keeps the plain group id
as the snapshot key, so its history continues; any other market's key is
``<group_id>#<market_id>``. ``snapshot_scopes`` lists every pair snapshotted
(``{"group_id", "market_id"}``), ``snapshot_group_ids`` their distinct groups.
A scope with ``market_ids`` evaluates only those markets.

Time budget (2.42.0): the run's answers are read pair by pair, the pairs with
the fewest keywords first, and no new pair is started once the Lambda's
remaining time falls under ``KPI_ALERTS_RESERVE_SECONDS``. The pairs left are
named in ``time_budget_scopes`` (counted in ``skipped_time_budget``) instead
of the whole step timing out with nothing recorded.

Alerts compare like for like (``shared.kpi_comparison``): the previous
snapshot's run rows are read back for the group's current keywords, only the
(keyword, persona, engine, market) cells answered in both runs are compared,
on neutral (non-branded) answers, and only when the comparison is
``comparable``. Each snapshot stores that ``comparison``.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, NamedTuple

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
    KPI_VERSION,
    build_alert_item,
    comparison_alerts,
    resolve_settings,
    snapshot_metrics,
    ttl_for_timestamp,
)
from shared.kpi_comparison import COMPARABLE, compare_runs
from shared.kpi_engine import Answer, answers_from_rows, owned_domains_from
from shared.markets import (
    GLOBAL_MARKET_ID,
    Market,
    brand_config_for_market,
    keyword_market_id,
    load_markets,
    market_scoped_key,
    markets_by_id,
)
from shared.request_deadline import Deadline, budget_from_context
from shared.search_results import search_results_table_name
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_MAX_WORKERS = 10
#: Seconds kept back from the Lambda's remaining time for the last snapshot writes, the SNS publish and the return.
KPI_ALERTS_RESERVE_SECONDS = 30.0
#: Pairs named in ``time_budget_scopes`` at most (the count is always exact); keeps the state small.
TIME_BUDGET_SCOPES_LISTED = 50

SEARCH_RESULTS_TABLE = search_results_table_name()
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


class GroupMarket(NamedTuple):
    """One keyword group in one market: the unit a snapshot covers."""

    group_id: str
    market_id: str

    @property
    def snapshot_key(self) -> str:
        """The snapshot ``group_id``: the plain group id for the global market, ``<group>#<market>`` otherwise."""
        return market_scoped_key(self.group_id, self.market_id)


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


def _input_scopes(execution_input: dict[str, Any]) -> list[dict[str, Any]]:
    """The scope descriptors of the execution input (``scope`` and the older ``requested_scope``)."""
    return [scope for scope in map(execution_input.get, ('scope', 'requested_scope')) if isinstance(scope, dict)]


def _scope_group_ids(
    execution_input: dict[str, Any],
    active_keywords: list[dict[str, Any]],
    all_group_ids: set[str],
) -> set[str]:
    selected: set[str] = set()
    all_groups = execution_input.get('source') == 'dynamodb'
    active_by_id = {str(item.get('id')): item for item in active_keywords if item.get('id')}

    for scope in _input_scopes(execution_input):
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


def _scope_market_ids(execution_input: dict[str, Any]) -> set[str] | None:
    """The markets the run's scope covers; ``None`` when there is no scope or one covers every market."""
    scopes = _input_scopes(execution_input)
    market_lists = [scope.get('market_ids') for scope in scopes]
    if not scopes or not all(isinstance(market_ids, list) for market_ids in market_lists):
        return None
    return {str(value) for market_ids in market_lists if isinstance(market_ids, list) for value in market_ids if value}


def _members_by_group(active_keywords: list[dict[str, Any]]) -> dict[GroupMarket, list[dict[str, Any]]]:
    """The active keywords of each (group, market) pair."""
    members: dict[GroupMarket, list[dict[str, Any]]] = {}
    for item in active_keywords:
        market_id = keyword_market_id(item)
        for group_id in keyword_group_ids(item):
            members.setdefault(GroupMarket(group_id, market_id), []).append(item)
    for rows in members.values():
        rows.sort(key=lambda item: str(item.get('keyword', '')).casefold())
    return members


def _complete_groups(
    touched: set[str],
    processed_names: list[str],
    members: dict[GroupMarket, list[dict[str, Any]]],
    market_ids: set[str] | None,
) -> tuple[list[GroupMarket], int]:
    """The (group, market) pairs of the touched groups whose every active keyword the run processed.

    A pair outside the scope's ``market_ids`` is not evaluated at all; a pair
    inside it that the run did not fully cover counts as partial.
    """
    processed = set(processed_names)
    complete: list[GroupMarket] = []
    skipped = 0
    for pair in sorted(members):
        if pair.group_id not in touched or (market_ids is not None and pair.market_id not in market_ids):
            continue
        names = {str(item['keyword']) for item in members[pair] if item.get('keyword')}
        if names and names <= processed:
            complete.append(pair)
        else:
            skipped += 1
    skipped += sum(1 for group_id in touched if not any(pair.group_id == group_id for pair in members))
    return complete, skipped


def _load_run_rows(
    keywords: list[str],
    timestamp: str,
    deadline: Deadline | None = None,
) -> dict[str, list[dict[str, Any]] | None]:
    """Each keyword's SearchResults rows (answers, no-answers and failed calls) in the run stamped ``timestamp``.

    ``None`` for a keyword that could not be read, or that was not started
    before ``deadline`` was spent.
    """
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)

    def load(keyword: str) -> tuple[str, list[dict[str, Any]] | None]:
        if deadline is not None and deadline.stop_reading('the exact-run answers read'):
            return keyword, None
        try:
            return keyword, query_keyword_run_rows(table, keyword, timestamp)
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
    for name in ('triggered_by', 'schedule_id', 'display_name', 'source'):
        value = execution_input.get(name)
        if isinstance(value, str) and value:
            result[name] = value
    for name in ('scope', 'requested_scope'):
        value = execution_input.get(name)
        if isinstance(value, dict):
            result[name] = value
    return result


def _snapshot(
    pair: GroupMarket,
    group_name: str,
    execution_id: str,
    execution_input: dict[str, Any],
    report: dict[str, Any],
    timestamp: str,
    metrics: dict[str, Any],
) -> dict[str, Any]:
    return {
        'group_id': pair.snapshot_key,
        'snapshot_at': timestamp,
        'group_name': group_name,
        'market_id': pair.market_id,
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


def _tracked_competitors(brand_config: Mapping[str, Any], markets: Mapping[str, Market], market_id: str) -> list[str]:
    """The competitors configured for one market: the brand config's list plus the market's own.

    The snapshot's ``competitors`` (the new-competitor rule) are limited to
    these names; the extraction model's own competitor labels are not trusted.
    """
    tracked = brand_config_for_market(brand_config, markets.get(market_id)).get('tracked_brands')
    competitors = tracked.get('competitors') if isinstance(tracked, Mapping) else None
    return [name for name in competitors if isinstance(name, str)] if isinstance(competitors, list) else []


def _message(alerts: list[dict[str, Any]], execution_id: str) -> str:
    visible = alerts[:20]
    lines = [
        f'Citation Analysis detected {len(alerts)} new KPI alert(s) for execution {execution_id}.',
        *[
            f"- [{item['severity'].upper()}] {_market_label(item)}{' '.join(str(item['message']).split())}"
            for item in visible
        ],
    ]
    if len(alerts) > len(visible):
        lines.append(f'- {len(alerts) - len(visible)} additional alert(s) are available in the dashboard.')
    return '\n'.join(lines)


def _market_label(item: dict[str, Any]) -> str:
    """``'[cl-es] '`` for an alert of a non-global market, ``''`` otherwise."""
    market_id = item.get('market_id')
    return f'[{market_id}] ' if isinstance(market_id, str) and market_id != GLOBAL_MARKET_ID else ''


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


def handler(event: object, context: Any) -> dict[str, Any]:
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
    complete, skipped_partial = _complete_groups(touched, processed_names, members, _scope_market_ids(execution_input))
    if not complete:
        return {
            'status': 'completed',
            'run_timestamp': run_timestamp,
            'groups_evaluated': 0,
            'snapshots_recorded': 0,
            'snapshot_group_ids': [],
            'snapshot_scopes': [],
            'alerts_created': 0,
            'skipped_partial': skipped_partial,
            'notification': {'status': 'not_sent', 'reason': 'no_new_alerts'},
        }
    settings = _settings()
    brand_config = get_brand_config(BRAND_CONFIG_TABLE)
    # The markets, read once: each (group, market) pair tracks the market's extra competitors.
    markets = markets_by_id(load_markets(dynamodb.Table(BRAND_CONFIG_TABLE)))
    evaluation = _Evaluation(
        run_timestamp=run_timestamp, execution_id=execution_id, execution_input=execution_input, report=report,
        settings=settings, brand_config=brand_config, markets=markets, groups_by_id=groups_by_id,
        deadline=Deadline(budget_from_context(context, KPI_ALERTS_RESERVE_SECONDS)),
    )
    for pair in sorted(complete, key=lambda pair: len(members[pair])):
        evaluation.evaluate(pair, [str(item['keyword']) for item in members[pair] if item.get('keyword')])
    # Reported in the pairs' usual order, whatever order the time budget read them in.
    snapshotted = [pair for pair in complete if pair in evaluation.snapshotted]
    new_alerts = evaluation.new_alerts
    skipped_partial += evaluation.skipped_partial
    if evaluation.out_of_time:
        logger.warning('Time budget spent: %d group/market pair(s) left unevaluated', len(evaluation.out_of_time))

    notification = _notify(new_alerts, execution_id, settings)
    return {
        'status': 'completed',
        'run_timestamp': run_timestamp,
        'groups_evaluated': len(snapshotted),
        'snapshots_recorded': len(snapshotted),
        'snapshot_group_ids': list(dict.fromkeys(pair.group_id for pair in snapshotted)),
        'snapshot_scopes': [{'group_id': pair.group_id, 'market_id': pair.market_id} for pair in snapshotted],
        'alerts_created': len(new_alerts),
        'skipped_partial': skipped_partial,
        'skipped_time_budget': len(evaluation.out_of_time),
        'time_budget_scopes': [
            {'group_id': pair.group_id, 'market_id': pair.market_id}
            for pair in evaluation.out_of_time[:TIME_BUDGET_SCOPES_LISTED]
        ],
        'notification': notification,
    }


@dataclass
class _Evaluation:
    """The run's (group, market) pairs evaluated one at a time inside the time budget."""

    run_timestamp: str
    execution_id: str
    execution_input: dict[str, Any]
    report: dict[str, Any]
    settings: dict[str, Any]
    brand_config: dict[str, Any]
    markets: dict[str, Market]
    groups_by_id: dict[str, dict[str, Any]]
    deadline: Deadline
    rows: dict[str, list[dict[str, Any]] | None] = field(default_factory=dict)
    snapshotted: set[GroupMarket] = field(default_factory=set)
    new_alerts: list[dict[str, Any]] = field(default_factory=list)
    out_of_time: list[GroupMarket] = field(default_factory=list)
    skipped_partial: int = 0

    def evaluate(self, pair: GroupMarket, keywords: list[str]) -> None:
        """Snapshot ``pair`` when every keyword of it answered; reads only the keywords no earlier pair read."""
        if self.deadline.expired():
            self.out_of_time.append(pair)
            return
        unread = sorted({keyword for keyword in keywords if keyword not in self.rows}, key=str.casefold)
        if unread:
            self.rows.update(_load_run_rows(unread, self.run_timestamp, self.deadline))
        group_answers = {keyword: answers for keyword in keywords if (answers := self._answers(keyword))}
        # A keyword that could not be read, or that no engine answered, leaves the run incomplete.
        if len(group_answers) < len(keywords):
            if self.deadline.expired():
                self.out_of_time.append(pair)
            else:
                self.skipped_partial += 1
            return
        group = _GroupRun(
            pair=pair,
            name=str(self.groups_by_id[pair.group_id].get('name') or pair.group_id),
            keywords=keywords,
            rows=[row for keyword in keywords for row in self.rows.get(keyword) or []],
            tracked_competitors=_tracked_competitors(self.brand_config, self.markets, pair.market_id),
        )
        metrics = snapshot_metrics(group_answers, self.owned_domains, group.tracked_competitors)
        snapshot = _snapshot(
            pair, group.name, self.execution_id, self.execution_input, self.report, self.run_timestamp, metrics,
        )
        alerts = _record_snapshot(group, snapshot, self)
        if alerts is None:
            # The previous run's rows could not be read before the deadline: a like-for-like comparison is
            # impossible, so the pair is left for the time budget rather than compared with part of its past.
            self.out_of_time.append(pair)
            return
        self.new_alerts.extend(alerts)
        self.snapshotted.add(pair)

    @property
    def owned_domains(self) -> list[str]:
        return owned_domains_from(self.brand_config)

    def _answers(self, keyword: str) -> list[Answer] | None:
        rows = self.rows.get(keyword)
        return None if rows is None else answers_from_rows(rows)


class _GroupRun(NamedTuple):
    """One (group, market) pair fully covered by the run: its keywords, their run rows and tracked competitors."""

    pair: GroupMarket
    name: str
    keywords: list[str]
    rows: list[dict[str, Any]]
    tracked_competitors: list[str]


def _previous_run_rows(group: _GroupRun, previous: dict[str, Any], deadline: Deadline) -> list[dict[str, Any]] | None:
    """The rows of the group's current keywords in the previous snapshot's run, read within ``deadline``.

    ``None`` when any keyword could not be read (the deadline ran out, or its read failed): the caller then leaves
    the pair unevaluated instead of comparing against part of the previous run.
    """
    rows_by_keyword = _load_run_rows(group.keywords, str(previous['snapshot_at']), deadline)
    if any(rows_by_keyword.get(keyword) is None for keyword in group.keywords):
        return None
    return [row for keyword in group.keywords for row in rows_by_keyword.get(keyword) or []]


def _record_snapshot(group: _GroupRun, snapshot: dict[str, Any], evaluation: _Evaluation) -> list[dict[str, Any]] | None:
    """Store one (group, market) snapshot and the alerts it raises against the previous one; the new alerts.

    ``None`` (nothing stored) when the previous run's rows could not be read within the time budget.

    The snapshot records its ``comparison`` with the previous snapshot
    (``shared.kpi_comparison``): the state, the matched cells, both runs'
    answered shares and ``previous_snapshot_at``. A previous snapshot measured
    with other KPI definitions is no previous snapshot. Alerts are raised only
    for a ``comparable`` pair of runs, on the neutral answers of their matched
    cells.
    """
    pair = group.pair
    previous = _previous_snapshot(pair.snapshot_key, evaluation.run_timestamp)
    if previous is not None and previous.get('kpi_version') != KPI_VERSION:
        previous = None
    previous_rows = None
    if previous is not None:
        previous_rows = _previous_run_rows(group, previous, evaluation.deadline)
        if previous_rows is None:
            return None
    comparison = compare_runs(previous_rows, group.rows)
    snapshot['comparison'] = {
        **comparison.to_json(),
        'previous_snapshot_at': None if previous is None else previous.get('snapshot_at'),
    }
    settings = evaluation.settings
    # Content-change markers are recorded per group, for every market of it.
    marker = (
        _content_change(pair.group_id, str(previous['snapshot_at']), evaluation.run_timestamp)
        if previous is not None and comparison.state == COMPARABLE and settings.get('enabled')
        else None
    )
    dynamodb.Table(SNAPSHOTS_TABLE).put_item(Item=convert_floats_to_decimal(snapshot))
    specifications = comparison_alerts(
        previous, snapshot, comparison, settings,
        content_marker=marker,
        owned_domains=evaluation.owned_domains,
        tracked_competitors=group.tracked_competitors,
    )
    created: list[dict[str, Any]] = []
    for specification in specifications:
        item = build_alert_item(
            specification,
            execution_id=evaluation.execution_id,
            group_id=pair.group_id,
            group_name=group.name,
            created_at=evaluation.run_timestamp,
            run_timestamp=evaluation.run_timestamp,
            market_id=pair.market_id,
        )
        if _put_new_alert(item):
            created.append(item)
    return created
