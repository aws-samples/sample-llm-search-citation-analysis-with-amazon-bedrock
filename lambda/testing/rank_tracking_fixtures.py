"""Test support for rank tracking: an in-memory ``CitationAnalysis-SeoRankTracking`` and example records.

``RankTable`` keeps items by ``(pk, sk)`` and evaluates the boto3 condition objects the code passes
(``Attr`` / ``Key``: ``=``, ``<``, ``<=``, ``>=``, ``BETWEEN``, ``begins_with``, ``IN``, ``attribute_(not_)exists``,
``AND`` / ``OR``), so conditional writes, the lock and GSI queries run their real rules. Fictional domains only.
"""

from __future__ import annotations

from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal
from unittest.mock import MagicMock

import pytest
from boto3.dynamodb.conditions import ConditionBase

from shared import rank_tracking_checks
from shared.dataforseo_locations import MarketCodes
from shared.dataforseo_rank import RankCheck
from shared.dataforseo_tasks import PostedTasks, TaskOutcome
from shared.rank_tracking_store import Tracker
from testing.dynamodb_stubs import conditional_check_failure

NOW = datetime(2026, 10, 5, 8, 0, tzinfo=UTC)
NOW_TEXT = '2026-10-05T08:00:00.000000Z'
CODES = MarketCodes(location_code=2840, language_code='en', keyword_data='labs')

_MISSING = object()
_INDEX_KEYS = {'GSI1': ('gsi1pk', 'gsi1sk'), None: ('pk', 'sk')}


def _name(operand: Any) -> str:
    return operand.name


def _compare(operator: str, actual: Any, values: tuple[Any, ...]) -> bool:
    if actual is _MISSING:
        return False
    checks = {
        '=': lambda: actual == values[0],
        '<': lambda: actual < values[0],
        '<=': lambda: actual <= values[0],
        '>=': lambda: actual >= values[0],
        'BETWEEN': lambda: values[0] <= actual <= values[1],
        'begins_with': lambda: str(actual).startswith(values[0]),
        'IN': lambda: actual in values[0],
    }
    return checks[operator]()


def matches(condition: ConditionBase, item: Mapping[str, Any] | None) -> bool:
    """Whether ``item`` (``None`` = absent) satisfies ``condition``."""
    expression = condition.get_expression()
    operator, values = expression['operator'], expression['values']
    if operator == 'AND':
        return matches(values[0], item) and matches(values[1], item)
    if operator == 'OR':
        return matches(values[0], item) or matches(values[1], item)
    actual = (item or {}).get(_name(values[0]), _MISSING)
    if operator == 'attribute_not_exists':
        return actual is _MISSING
    if operator == 'attribute_exists':
        return actual is not _MISSING
    return _compare(operator, actual, tuple(values[1:]))


@dataclass
class RankTable:
    """The rank tracking table in memory."""

    items: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    page_size: int | None = None

    def get_item(self, Key: Mapping[str, str]) -> dict[str, Any]:
        item = self.items.get((Key['pk'], Key['sk']))
        return {'Item': deepcopy(item)} if item is not None else {}

    def put_item(self, Item: Mapping[str, Any], ConditionExpression: ConditionBase | None = None) -> None:
        key = (Item['pk'], Item['sk'])
        if ConditionExpression is not None and not matches(ConditionExpression, self.items.get(key)):
            raise conditional_check_failure('PutItem')
        self.items[key] = deepcopy(dict(Item))

    def delete_item(self, Key: Mapping[str, str], ConditionExpression: ConditionBase | None = None) -> None:
        key = (Key['pk'], Key['sk'])
        if ConditionExpression is not None and not matches(ConditionExpression, self.items.get(key)):
            raise conditional_check_failure('DeleteItem')
        self.items.pop(key, None)

    def query(self, KeyConditionExpression: ConditionBase, IndexName: str | None = None,
              ScanIndexForward: bool = True, Limit: int | None = None,
              ExclusiveStartKey: Mapping[str, Any] | None = None, **_extra: Any) -> dict[str, Any]:
        _pk, sort_key = _INDEX_KEYS[IndexName]
        found = [item for item in self.items.values() if matches(KeyConditionExpression, item)]
        found.sort(key=lambda item: str(item.get(sort_key, '')), reverse=not ScanIndexForward)
        start = int(ExclusiveStartKey['offset']) if ExclusiveStartKey else 0
        size = Limit or self.page_size or len(found) or 1
        page = found[start:start + size]
        answer: dict[str, Any] = {'Items': deepcopy(page)}
        if self.page_size and start + size < len(found) and not Limit:
            answer['LastEvaluatedKey'] = {'offset': start + size}
        return answer

    @contextmanager
    def batch_writer(self, **_options: Any) -> Generator[RankTable]:
        yield self


@dataclass
class KeywordsTable:
    """``CitationAnalysis-Keywords`` in memory: ``query`` answers the active rows (its ``StatusIndex`` read)."""

    rows: list[dict[str, Any]] = field(default_factory=list)
    queries: int = 0

    def query(self, **_params: Any) -> dict[str, Any]:
        self.queries += 1
        return {'Items': deepcopy([row for row in self.rows if row.get('status') == 'active'])}

    def add(self, keyword: str, *, market_id: str | None = None, group_ids: Sequence[str] = (),
            status: str = 'active') -> None:
        """Store a Settings keyword (``market_id=None`` = the global market)."""
        row: dict[str, Any] = {'id': f'k-{len(self.rows) + 1}', 'keyword': keyword, 'status': status}
        if market_id:
            row['market_id'] = market_id
        if group_ids:
            row['group_ids'] = set(group_ids)
        self.rows.append(row)


def tracker(**overrides: Any) -> Tracker:
    """An active weekly tracker of ``example.com`` in the global market, on both devices."""
    fields: dict[str, Any] = {
        'tracker_id': 'rt-example', 'domain': 'example.com', 'market_id': 'global', 'devices': 'both',
        'depth': 30, 'schedule': 'weekly', 'created_at': '2026-09-01T08:00:00.000000Z',
        'updated_at': '2026-09-01T08:00:00.000000Z', 'next_check_at': '2026-10-05T06:00:00.000000Z', 'version': 1,
    }
    fields.update(overrides)
    return Tracker(**fields)


def stored_tracker(table: RankTable, **overrides: Any) -> Tracker:
    """``tracker(**overrides)`` written to ``table``."""
    record = tracker(**overrides)
    table.put_item(Item=record.to_item())
    return record


def serp_result(*items: Mapping[str, Any]) -> dict[str, Any]:
    """A SERP ``result[0]`` with ``items``."""
    return {'keyword': 'cheap flights', 'items': [dict(item) for item in items]}


def organic(rank_group: int, domain: str, *, rank_absolute: int | None = None, url: str | None = None) -> dict[str, Any]:
    """One organic SERP item."""
    return {'type': 'organic', 'rank_group': rank_group, 'rank_absolute': rank_absolute or rank_group + 1,
            'domain': domain, 'url': url or f'https://{domain}/page'}


def pair(keyword_id: str, device: str, *, run_id: str = 'run-1', status: str = 'pending', answered: bool = False,
         position: int | None = None, **extra: Any) -> dict[str, Any]:
    """A stored pair item of run ``run_id``."""
    item: dict[str, Any] = {
        'pk': f'RUN#{run_id}', 'sk': f'PAIR#{keyword_id}#{device}', 'run_id': run_id, 'tracker_id': 'rt-example',
        'keyword_id': keyword_id, 'keyword': f'keyword {keyword_id}', 'device': device, 'status': status,
        'answered': answered, **extra,
    }
    if position is not None:
        item['position'] = position
    return item


def fake_live_checks(monkeypatch: pytest.MonkeyPatch, position: int | None = 4) -> MagicMock:
    """Live checks that find ``example.com`` at ``position`` (``None`` = not found) for $0.005 each."""
    url = None if position is None else 'https://example.com/a'
    check = MagicMock(return_value=(RankCheck(position, None if position is None else position + 1, url, ('organic',)),
                                    0.005))
    monkeypatch.setattr(rank_tracking_checks, 'live_rank_check', check)
    return check


def fake_task_posts(monkeypatch: pytest.MonkeyPatch, accepted: Mapping[str, str] | None = None) -> MagicMock:
    """``task_post`` accepting the tags of ``accepted`` (tag -> task id) and nothing else."""
    tags = dict(accepted or {})
    post = MagicMock(return_value=PostedTasks(accepted=tags, rejected={}, cost_usd=0.0015 * len(tags)))
    monkeypatch.setattr(rank_tracking_checks, 'post_tasks', post)
    return post


def fake_task_polls(monkeypatch: pytest.MonkeyPatch, status: Literal['pending', 'failed', 'completed'], result: dict[str, Any] | None = None) -> MagicMock:
    """``task_get`` answering every task with ``status`` (and ``result``)."""
    poll = MagicMock(return_value=TaskOutcome(status, result, None))
    monkeypatch.setattr(rank_tracking_checks, 'get_task', poll)
    return poll


__all__ = [
    'CODES',
    'NOW',
    'NOW_TEXT',
    'RankTable',
    'fake_live_checks',
    'fake_task_polls',
    'fake_task_posts',
    'matches',
    'organic',
    'pair',
    'serp_result',
    'stored_tracker',
    'tracker',
]
