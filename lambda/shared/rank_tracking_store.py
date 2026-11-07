"""Rank trackers and their keywords in ``CitationAnalysis-SeoRankTracking`` (single table, ``pk`` / ``sk``).

Items of a tracker's partition ``TRACKER#<tracker_id>``:

- ``META``: the tracker (domain, market, devices, depth, schedule, keyword scope and group, schedule state). Listed through
  ``GSI1`` (``TRACKERS`` / ``<created_at>#<tracker_id>``); due trackers through the sparse ``GSI2``
  (``DUE`` / ``<next_check_at>#<tracker_id>``), whose keys exist only while the tracker is active and scheduled.
  Every write is conditioned on the ``version`` it read, so the scheduler's claim and an edit never overwrite
  each other: the second writer sees a conflict and re-reads.
- ``KW#<keyword_id>``: an extra keyword added by hand. The tracker's own keywords come from Settings > Keywords
  at run time, by its ``keyword_scope``: ``all`` = every active keyword of the tracker's market (keywords without
  a market for the global one), ``group`` = the active keywords of its keyword group. Adding a keyword in Settings
  therefore adds it to the tracker; Settings stays the one place keywords are managed. A tracker stored before
  ``keyword_scope`` existed reads as ``group`` when it has a group, else as ``list`` (its extra keywords only).
- ``STATE#<keyword_id>``, ``ACTIVE_RUN`` and ``RUN#<run_id>``: see ``shared.rank_tracking_runs``.

A tracker is identified by its (domain, market): its id is derived from both, so creating it twice addresses the
same item, and re-creating an archived tracker reactivates it with its history. A keyword's id is derived from
its normalized text, so a keyword both in the scope and added by hand is checked once.
"""

from __future__ import annotations

import functools
import hashlib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from shared.dynamo_decimal import plain
from shared.dynamodb_batch import collect_all_items
from shared.env_vars import resolve_table_env
from shared.keyword_groups import query_active_keywords, select_scope
from shared.kpi_engine import normalize_domain
from shared.utils import normalize_keyword

__all__ = [
    'DEVICE_CHOICES',
    'DUE_INDEX_KEY',
    'KEYWORD_SCOPES',
    'LIST_SCOPE',
    'MAX_KEYWORDS',
    'TABLE_ENV',
    'KeywordSelection',
    'StaleWriteError',
    'TrackedKeyword',
    'Tracker',
    'active_keywords_for',
    'add_keywords',
    'device_list',
    'get_tracker',
    'is_conditional_failure',
    'keyword_id_for',
    'list_keywords',
    'list_trackers',
    'normalize_tracked_domain',
    'put_tracker',
    'rank_table',
    'remove_keywords',
    'resolve_run_keywords',
    'select_run_keywords',
    'tracker_id_for',
    'tracker_pk',
]

TABLE_ENV = 'DYNAMODB_TABLE_SEO_RANK_TRACKING'
MAX_KEYWORDS = 1000
"""Keywords one tracker checks (its scope's and the extra ones together); the rest of a larger scope is skipped."""
KEYWORD_SCOPES = ('all', 'group')
"""The Settings keywords a tracker checks: every active keyword of its market, or one keyword group."""
LIST_SCOPE = 'list'
"""The scope a tracker stored before ``keyword_scope`` reads as when it has no group: its extra keywords only."""
DEVICE_CHOICES = ('desktop', 'mobile', 'both')
TRACKERS_INDEX_KEY = 'TRACKERS'
DUE_INDEX_KEY = 'DUE'


class StaleWriteError(Exception):
    """A conditional write lost to a concurrent one (the item changed since it was read)."""


@functools.cache
def rank_table() -> Any:
    """``CitationAnalysis-SeoRankTracking``, opened once per container (tests replace this function)."""
    return boto3.resource('dynamodb').Table(resolve_table_env(TABLE_ENV))


def is_conditional_failure(error: ClientError) -> bool:
    return error.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException'


def normalize_tracked_domain(text: str) -> str | None:
    """The host to track: lower-case, without scheme, path, port or a leading ``www.``; ``None`` when invalid."""
    host = normalize_domain(text)
    if host is None or '.' not in host or len(host) > 253:
        return None
    labels = host.split('.')
    if any(not label or len(label) > 63 or not all(ch.isalnum() or ch == '-' for ch in label) for label in labels):
        return None
    return host


def _digest(text: str, length: int) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:length]


def tracker_id_for(domain: str, market_id: str) -> str:
    return f'rt-{_digest(f"{domain}|{market_id}", 16)}'


def keyword_id_for(keyword: str) -> str:
    return f'kw-{_digest(keyword, 16)}'


def tracker_pk(tracker_id: str) -> str:
    return f'TRACKER#{tracker_id}'


def device_list(devices: str) -> list[str]:
    """The devices a tracker checks, desktop first."""
    return ['desktop', 'mobile'] if devices == 'both' else [devices]


@dataclass(frozen=True)
class Tracker:
    """One rank tracker (the ``META`` item)."""

    tracker_id: str
    domain: str
    market_id: str
    devices: str
    depth: int
    schedule: str
    created_at: str
    updated_at: str
    group_id: str | None = None
    keyword_scope: str = 'all'
    is_active: bool = True
    next_check_at: str | None = None
    last_checked_at: str | None = None
    last_skip_reason: str | None = None
    keyword_count: int = 0
    """The extra (hand-added) keywords; the scope's keywords are counted when read."""
    version: int = 0

    @classmethod
    def from_item(cls, item: Mapping[str, Any]) -> Tracker:
        data = plain(item)
        values = {name: data[name] for name in cls.__dataclass_fields__ if name in data}
        values.setdefault('keyword_scope', 'group' if data.get('group_id') else LIST_SCOPE)
        return cls(**values)

    def to_item(self) -> dict[str, Any]:
        item: dict[str, Any] = {key: value for key, value in asdict(self).items() if value is not None}
        item.update(pk=tracker_pk(self.tracker_id), sk='META', gsi1pk=TRACKERS_INDEX_KEY,
                    gsi1sk=f'{self.created_at}#{self.tracker_id}')
        if self.is_active and self.schedule != 'manual' and self.next_check_at:
            item.update(gsi2pk=DUE_INDEX_KEY, gsi2sk=f'{self.next_check_at}#{self.tracker_id}')
        return item


def get_tracker(table: Any, tracker_id: str) -> Tracker | None:
    item = table.get_item(Key={'pk': tracker_pk(tracker_id), 'sk': 'META'}).get('Item')
    return Tracker.from_item(item) if item else None


def list_trackers(table: Any) -> list[Tracker]:
    """Every tracker, oldest first."""
    items = collect_all_items(table.query, IndexName='GSI1', KeyConditionExpression=Key('gsi1pk').eq(TRACKERS_INDEX_KEY))
    return [Tracker.from_item(item) for item in items]


def put_tracker(table: Any, tracker: Tracker, expected_version: int | None) -> Tracker:
    """Write ``tracker`` as version ``expected_version + 1`` (``None`` = a new item); ``StaleWriteError`` on a race."""
    stored = replace(tracker, version=(expected_version or 0) + 1)
    condition = Attr('pk').not_exists() if expected_version is None else Attr('version').eq(expected_version)
    try:
        table.put_item(Item=stored.to_item(), ConditionExpression=condition)
    except ClientError as error:
        if is_conditional_failure(error):
            raise StaleWriteError(tracker.tracker_id) from error
        raise
    return stored


@dataclass(frozen=True)
class TrackedKeyword:
    keyword_id: str
    keyword: str
    source: str
    """``list`` (an extra keyword added by hand), ``market`` (a Settings keyword of the tracker's market) or
    ``group`` (from the tracker's keyword group)."""


def list_keywords(table: Any, tracker_id: str) -> list[TrackedKeyword]:
    """The hand-added keywords, in keyword-id order."""
    items = collect_all_items(
        table.query, KeyConditionExpression=Key('pk').eq(tracker_pk(tracker_id)) & Key('sk').begins_with('KW#'),
    )
    return [TrackedKeyword(str(item['keyword_id']), str(item['keyword']), 'list') for item in items]


def add_keywords(table: Any, tracker_id: str, keywords: Sequence[str], added_at: str) -> int:
    """Add normalized ``keywords`` not yet on the tracker; the number added."""
    existing = {entry.keyword_id for entry in list_keywords(table, tracker_id)}
    fresh = {keyword_id_for(keyword): keyword for keyword in keywords}
    new = {keyword_id: keyword for keyword_id, keyword in fresh.items() if keyword_id not in existing}
    with table.batch_writer() as batch:
        for keyword_id, keyword in new.items():
            batch.put_item(Item={'pk': tracker_pk(tracker_id), 'sk': f'KW#{keyword_id}', 'keyword_id': keyword_id,
                                 'keyword': keyword, 'added_at': added_at})
    return len(new)


def remove_keywords(table: Any, tracker_id: str, keyword_ids: Iterable[str]) -> int:
    """Remove hand-added keywords (their history stays); the number removed."""
    existing = {entry.keyword_id for entry in list_keywords(table, tracker_id)}
    doomed = [keyword_id for keyword_id in dict.fromkeys(keyword_ids) if keyword_id in existing]
    with table.batch_writer() as batch:
        for keyword_id in doomed:
            batch.delete_item(Key={'pk': tracker_pk(tracker_id), 'sk': f'KW#{keyword_id}'})
    return len(doomed)


def _scope_descriptor(tracker: Tracker) -> dict[str, Any] | None:
    """The ``shared.keyword_groups`` scope of ``tracker``'s Settings keywords; ``None`` when it has none."""
    if tracker.keyword_scope == 'all':
        return {'mode': 'all', 'market_ids': [tracker.market_id]}
    if tracker.keyword_scope == 'group' and tracker.group_id:
        return {'mode': 'groups', 'group_ids': [tracker.group_id]}
    return None


def active_keywords_for(keywords_table: Any, trackers: Iterable[Tracker]) -> list[dict[str, Any]]:
    """The active Keywords rows, read once for every tracker of ``trackers`` (no read when none has a scope)."""
    if all(_scope_descriptor(tracker) is None for tracker in trackers):
        return []
    return query_active_keywords(keywords_table)


@dataclass(frozen=True)
class KeywordSelection:
    """A tracker's keywords: the extra ones first, then its scope's, deduplicated (before the cap)."""

    every: list[TrackedKeyword]

    @property
    def keywords(self) -> list[TrackedKeyword]:
        """The keywords a run checks: the first ``MAX_KEYWORDS``."""
        return self.every[:MAX_KEYWORDS]

    @property
    def total(self) -> int:
        """Distinct keywords before the cap (more than ``MAX_KEYWORDS`` when the scope is larger)."""
        return len(self.every)


def _scope_keywords(active: list[dict[str, Any]], tracker: Tracker) -> list[TrackedKeyword]:
    scope = _scope_descriptor(tracker)
    if scope is None:
        return []
    source = 'market' if tracker.keyword_scope == 'all' else 'group'
    tracked: list[TrackedKeyword] = []
    for item in select_scope(scope, active):
        text = normalize_keyword(str(item.get('keyword') or ''))
        if text:
            tracked.append(TrackedKeyword(keyword_id_for(text), text, source))
    return tracked


def select_run_keywords(table: Any, active: list[dict[str, Any]], tracker: Tracker) -> KeywordSelection:
    """``tracker``'s keywords given the ``active`` Keywords rows (``active_keywords_for``)."""
    unique: dict[str, TrackedKeyword] = {}
    for entry in [*list_keywords(table, tracker.tracker_id), *_scope_keywords(active, tracker)]:
        unique.setdefault(entry.keyword_id, entry)
    return KeywordSelection(list(unique.values()))


def resolve_run_keywords(table: Any, keywords_table: Any, tracker: Tracker) -> list[TrackedKeyword]:
    """Extra keywords, then the scope's active keywords, deduplicated, at most ``MAX_KEYWORDS``."""
    return select_run_keywords(table, active_keywords_for(keywords_table, [tracker]), tracker).keywords
