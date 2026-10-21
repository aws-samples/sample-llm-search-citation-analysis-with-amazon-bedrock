"""Volume tests for GET /api/schedules.

Before: every schedule in one response, each fetched with a serial
GetSchedule, each echoing its scope. A keyword scope holds up to 1,000 ids
(about 40 KB), so 150 such schedules came to about 6.3 MB, over the 6 MiB
Lambda cap, and 150 serial GetSchedule calls risked the 29 s API timeout.
Now one page of at most ``limit`` schedules is read (GetSchedule in
parallel, for that page only) and cut to the 1 MB page budget, continued by
``next_token``.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from testing.admin_authz_fixtures import caller_event
from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.events import parse_response
from testing.module_loader import load_handler_module
from testing.response_size import assert_within_page_budget

_ENV = {
    'STATE_MACHINE_ARN': 'arn:aws:states:us-east-1:123456789012:stateMachine:test',
    'SCHEDULE_ROLE_ARN': 'arn:aws:iam::123456789012:role/test-scheduler-role',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'test-keyword-groups',
    'CORS_ORIGIN_PARAM': '',
}

with (
    patch('boto3.client', return_value=MagicMock()),
    patch('boto3.resource', return_value=fake_dynamodb_resource()),
    patch.dict(os.environ, _ENV),
):
    _mod = load_handler_module(os.path.dirname(__file__), 'manage-schedule.py', 'manage_schedule_volume')

_BASE = datetime(2026, 9, 1, tzinfo=UTC)


class _NotFound(Exception):
    """EventBridge Scheduler's ResourceNotFoundException."""


def _detail(index: int, keyword_ids: int) -> dict[str, Any]:
    name = f'sch-{index:08x}'
    form = {'frequency': 'weekly', 'time': '09:00', 'timezone': 'Europe/Madrid', 'day_of_week': 'MON', 'day_of_month': 1}
    scope = {'mode': 'keywords', 'keyword_ids': [f'{index:04d}{n:04d}-0000-4000-8000-000000000000' for n in range(keyword_ids)]}
    return {
        'Name': name,
        'Description': f'Hotel Coruña {index}',
        'ScheduleExpression': _mod.build_cron(form),
        'ScheduleExpressionTimezone': form['timezone'],
        'State': 'ENABLED',
        'CreationDate': _BASE + timedelta(minutes=index),
        'Target': {'Input': json.dumps({'schedule_id': name, 'display_name': f'Hotel Coruña {index}', 'form': form, 'scope': scope})},
    }


def _scheduler(details: list[dict[str, Any]]) -> MagicMock:
    """A Scheduler client listing ``details`` 100 per ListSchedules page and answering GetSchedule."""
    by_name = {detail['Name']: detail for detail in details}
    summaries = [{'Name': detail['Name'], 'CreationDate': detail['CreationDate']} for detail in details]
    client = MagicMock()
    client.exceptions.ResourceNotFoundException = _NotFound
    client.get_schedule_group.return_value = {}
    client.get_detail_threads = set()

    def list_schedules(**params: Any) -> dict[str, Any]:
        start = int(params.get('NextToken', '0'))
        response: dict[str, Any] = {'Schedules': summaries[start:start + 100]}
        if start + 100 < len(summaries):
            response['NextToken'] = str(start + 100)
        return response

    def get_schedule(**params: Any) -> dict[str, Any]:
        client.get_detail_threads.add(threading.get_ident())
        # A network round trip's worth of waiting, so the pool keeps several calls in flight.
        time.sleep(0.002)
        return by_name[params['Name']]

    client.list_schedules.side_effect = list_schedules
    client.get_schedule.side_effect = get_schedule
    return client


def _list(client: MagicMock, query: dict[str, str] | None = None) -> dict[str, Any]:
    event = caller_event('GET', '/api/schedules', resource='/api/schedules', query=query or {})
    with patch.object(_mod, 'scheduler', client):
        return _mod.handler(event, {})


@pytest.fixture(scope='module')
def keyword_scoped() -> list[dict[str, Any]]:
    return [_detail(index, 1_000) for index in range(150)]


def test_stays_within_page_budget_when_schedules_carry_full_keyword_scopes(keyword_scoped: list[dict[str, Any]]) -> None:
    response = _list(_scheduler(keyword_scoped), {'limit': '100'})

    assert_within_page_budget(response)


def test_reads_details_only_for_the_requested_page(keyword_scoped: list[dict[str, Any]]) -> None:
    client = _scheduler(keyword_scoped)

    _status, body = parse_response(_list(client, {'limit': '10'}))

    assert (client.get_schedule.call_count, body['total'], body['count']) == (10, 150, 10)


def test_reads_page_details_in_parallel(keyword_scoped: list[dict[str, Any]]) -> None:
    client = _scheduler(keyword_scoped)

    _list(client, {'limit': '50'})

    assert len(client.get_detail_threads) > 1


@settings(max_examples=20, deadline=None)
@given(st.integers(min_value=0, max_value=130), st.integers(min_value=1, max_value=100))
def test_following_next_token_returns_every_schedule_once_newest_first(count: int, limit: int) -> None:
    client = _scheduler([_detail(index, 1) for index in range(count)])
    collected: list[str] = []
    query = {'limit': str(limit)}
    for _page in range(200):
        _status, body = parse_response(_list(client, query))
        collected.extend(item['id'] for item in body['schedules'])
        if body['next_token'] is None:
            break
        query = {'limit': str(limit), 'next_token': body['next_token']}

    assert collected == [f'sch-{index:08x}' for index in reversed(range(count))]


def test_rejects_malformed_next_token_with_400() -> None:
    status, body = parse_response(_list(_scheduler([]), {'next_token': 'e30'}))

    assert (status, body) == (400, {'error': 'Invalid next_token', 'field': 'next_token'})
