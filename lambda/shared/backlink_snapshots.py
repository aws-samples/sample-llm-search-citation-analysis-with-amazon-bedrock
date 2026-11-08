"""Weekly backlink snapshots of the brand's own and its competitors' domains (``CitationAnalysis-SeoBacklinkSnapshots``).

One item per domain and snapshot (pk ``domain``, sk ``snapshot_at`` ISO-8601 Z) holding the overview metrics of the
domain with its subdomains. Snapshots never expire: measured history is kept (TENETS.md, D2 and D5). Reading
them is free; only taking one calls DataForSEO (``summary/live``, about $0.024 a domain).

The tracked domains are the brand config's ``first_party_domains`` (``owned``) and ``competitor_domains``
(``competitor``, with the competitor's name), normalized like citations are (lower-case host without ``www.``),
deduplicated with the owned role winning, and limited to hosts the Backlinks API accepts.

The weekly schedule is off until an Admin turns it on: its setting is the item ``domain='#settings'``,
``snapshot_at='schedule'`` of the same table (``#`` never starts a domain, so it cannot collide).
"""

from __future__ import annotations

import functools
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

import boto3
from boto3.dynamodb.conditions import Key

from shared import snapshot_schedule
from shared.backlinks_target import is_registrable_host
from shared.dynamo_decimal import convert_floats_to_decimal, plain
from shared.env_vars import resolve_table_env
from shared.kpi_engine import normalize_domain

TABLE_ENV = 'DYNAMODB_TABLE_SEO_BACKLINK_SNAPSHOTS'
SETTINGS_DOMAIN = '#settings'
SCHEDULE_SORT_KEY = 'schedule'
HISTORY_POINTS = 110
"""About two years of weekly points per domain."""

METRIC_FIELDS = (
    'rank', 'backlinks', 'referring_domains', 'referring_pages', 'broken_backlinks', 'broken_pages',
    'backlinks_spam_score', 'target_spam_score', 'new_backlinks', 'lost_backlinks', 'new_referring_domains',
    'lost_referring_domains',
)

Role = Literal['owned', 'competitor']


def table_name() -> str:
    return resolve_table_env(TABLE_ENV)


@functools.cache
def snapshots_table() -> Any:
    """The snapshots table, opened once per container (tests replace the importing module's name)."""
    return boto3.resource('dynamodb').Table(table_name())


@dataclass(frozen=True)
class TrackedDomain:
    domain: str
    role: Role
    competitor: str | None


def _host(value: object) -> str | None:
    host = normalize_domain(value)
    return host if host and is_registrable_host(host) else None


def _competitor_domains(config: Mapping[str, Any]) -> list[tuple[str, object]]:
    raw = config.get('competitor_domains')
    if not isinstance(raw, Mapping):
        return []
    return [
        (str(name), value)
        for name, values in raw.items()
        if isinstance(values, list | tuple | set)
        for value in values
    ]


def tracked_domains(config: Mapping[str, Any]) -> list[TrackedDomain]:
    """Owned domains first, then competitors' (sorted by competitor, then domain), each domain once."""
    owned = config.get('first_party_domains')
    candidates: list[tuple[object, Role, str | None]] = [
        (value, 'owned', None) for value in (owned if isinstance(owned, list | tuple | set) else [])
    ]
    competitors = sorted(_competitor_domains(config), key=lambda pair: (pair[0].lower(), str(pair[1])))
    candidates.extend((value, 'competitor', name) for name, value in competitors)
    tracked: dict[str, TrackedDomain] = {}
    for value, role, competitor in candidates:
        host = _host(value)
        if host and host not in tracked:
            tracked[host] = TrackedDomain(domain=host, role=role, competitor=competitor)
    return list(tracked.values())


def snapshot_item(domain: str, metrics: Mapping[str, Any], snapshot_at: str) -> dict[str, Any]:
    """The table item of one snapshot (floats as ``Decimal``, missing metrics left out)."""
    values = {field: metrics.get(field) for field in METRIC_FIELDS if metrics.get(field) is not None}
    return convert_floats_to_decimal({
        'domain': domain, 'snapshot_at': snapshot_at, **values,
    })


def snapshot_point(item: Mapping[str, Any]) -> dict[str, Any]:
    """The API's snapshot point: ``snapshot_at`` and every metric (``null`` when it was not recorded)."""
    return {'snapshot_at': str(item.get('snapshot_at')), **{field: plain(item.get(field)) for field in METRIC_FIELDS}}


def domain_history(table: Any, domain: str, limit: int = HISTORY_POINTS) -> list[dict[str, Any]]:
    """The latest ``limit`` snapshots of ``domain``, oldest first."""
    answer = table.query(KeyConditionExpression=Key('domain').eq(domain), ScanIndexForward=False, Limit=limit)
    items = answer.get('Items') or []
    return [snapshot_point(item) for item in reversed(items)]


def latest_snapshot_at(table: Any, domain: str) -> str | None:
    answer = table.query(
        KeyConditionExpression=Key('domain').eq(domain), ScanIndexForward=False, Limit=1,
        ProjectionExpression='snapshot_at',
    )
    items = answer.get('Items') or []
    return str(items[0]['snapshot_at']) if items else None


SCHEDULE_KEY = {'domain': SETTINGS_DOMAIN, 'snapshot_at': SCHEDULE_SORT_KEY}


def schedule_enabled(table: Any) -> bool:
    return snapshot_schedule.schedule_enabled(table, SCHEDULE_KEY)


def set_schedule(table: Any, **choice: Any) -> None:
    snapshot_schedule.set_schedule(table, SCHEDULE_KEY, **choice)
