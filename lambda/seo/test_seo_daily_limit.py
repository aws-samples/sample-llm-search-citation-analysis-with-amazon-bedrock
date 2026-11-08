"""The one daily limit of paid DataForSEO calls per user (``shared.seo_spend_limit``), over the SEO router's stack.

Each request runs through ``limited`` and ``seo_http.seo_errors`` as on the router, and makes its DataForSEO
calls through the real client (``post_live``) on a scripted transport, so a refused call is one never sent.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from unittest.mock import MagicMock

import pytest
import seo_http
from botocore.exceptions import ClientError

from shared import seo_spend_limit
from shared.api_response import success_response
from shared.dataforseo_client import post_live
from testing.dataforseo_fixtures import InMemorySpendCounter, install_transport, ok_envelope
from testing.events import parse_response
from testing.seo_fixtures import seo_event

USER = 'admin@example.com'
LABS = '/v3/dataforseo_labs/google/keyword_ideas/live'


class Limit:
    """The counter table, the ProviderConfig row an Admin set (``None``: no row) and the audit table."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, daily_call_limit: int | None) -> None:
        self.counter = InMemorySpendCounter()
        self.config = MagicMock()
        row = {'provider_id': 'dataforseo', 'daily_call_limit': daily_call_limit}
        self.config.get_item.return_value = {'Item': row} if daily_call_limit is not None else {}
        self.audit = MagicMock()
        monkeypatch.setattr(seo_spend_limit, '_counter_table', lambda: self.counter)
        monkeypatch.setattr(seo_spend_limit, '_config_table', lambda: self.config)
        monkeypatch.setattr(seo_spend_limit.boto3, 'resource', lambda _name: MagicMock(Table=lambda _n: self.audit))
        monkeypatch.setenv('DYNAMODB_TABLE_MCP_STATE', 'test-mcp-state')

    def audit_items(self) -> list[dict[str, Any]]:
        return [call.kwargs['Item'] for call in self.audit.put_item.call_args_list]


def making(calls: int) -> Callable[[dict[str, Any], Any], dict[str, Any]]:
    """A sub-handler that makes ``calls`` billed DataForSEO calls, behind the SEO error answers."""
    def route(event: dict[str, Any], _context: Any) -> dict[str, Any]:
        for _ in range(calls):
            post_live(LABS, {'keywords': ['x']})
        return success_response({'calls': calls}, event)

    return seo_http.seo_errors(route)


def ask(route: Callable[[dict[str, Any], Any], dict[str, Any]], path: str = '/api/seo/keywords/research',
        claims: dict[str, str] | None = None) -> tuple[int, dict[str, Any]]:
    event = seo_event('POST', path, body={'keyword': 'x'})
    if claims is not None:
        event['requestContext']['authorizer']['claims'] = claims
    return parse_response(seo_spend_limit.limited(route)(event, None))


@pytest.fixture
def transport(monkeypatch):
    return install_transport(monkeypatch, *[ok_envelope() for _ in range(10)])


def test_refuses_a_headless_rest_client_once_the_shared_budget_is_used_up(monkeypatch, transport):
    limit = Limit(monkeypatch, 2)

    answers = [ask(making(1))[0] for _ in range(3)]
    status, body = ask(making(1))

    assert (answers, status, body['code'], len(transport.calls)) == ([200, 200, 429], 429, 'DAILY_LIMIT', 2)
    assert limit.counter.calls_of(USER) == 2


def test_counts_each_billed_call_of_a_request(monkeypatch, transport):
    limit = Limit(monkeypatch, 100)

    ask(making(3))

    assert limit.counter.calls_of(USER) == 3


def test_stops_a_request_at_the_call_that_would_pass_the_limit(monkeypatch, transport):
    limit = Limit(monkeypatch, 2)

    status, _body = ask(making(3))

    assert (status, len(transport.calls), limit.counter.calls_of(USER)) == (429, 2, 2)


def test_sends_no_paid_call_when_an_admin_set_the_limit_to_zero(monkeypatch, transport):
    Limit(monkeypatch, 0)

    status, body = ask(making(1))

    assert (status, body['code'], transport.calls) == (429, 'DAILY_LIMIT', [])


def test_allows_100_calls_a_day_when_no_limit_is_set(monkeypatch, transport):
    limit = Limit(monkeypatch, None)
    limit.counter.items[f'spend#{USER}#' + seo_spend_limit._today()] = {'calls': 99}

    assert (ask(making(1))[0], ask(making(1))[0]) == (200, 429)


def test_counts_nothing_for_an_answer_read_from_the_cache(monkeypatch, transport):
    limit = Limit(monkeypatch, 1)

    assert (ask(making(0))[0], limit.counter.calls_of(USER)) == (200, 0)


def test_does_not_meter_a_free_route(monkeypatch, transport):
    limit = Limit(monkeypatch, 0)
    event = seo_event('GET', '/api/seo/seo-geo')

    status, _body = parse_response(seo_spend_limit.limited(making(1))(event, None))

    assert (status, limit.audit_items()) == (200, [])


def test_counts_an_export_read_against_the_exports_owner(monkeypatch, transport):
    limit = Limit(monkeypatch, 5)

    ask(making(1), '/api/seo/domains/overview', {'cognito:username': 'export-service', 'custom:export_owner': 'alice'})

    assert (limit.counter.calls_of('alice'), limit.counter.calls_of('export-service')) == (1, 0)


def test_audits_each_paid_request_with_who_what_how_and_its_calls(monkeypatch, transport):
    limit = Limit(monkeypatch, 3)

    ask(making(2))
    ask(making(2))

    assert [(item['pk'], item['tool'], item['operation'], item['outcome'], item['calls'], item.get('reason'))
            for item in limit.audit_items()] == [
        (f'audit#{USER}', 'seo-api', 'POST /api/seo/keywords/research', 'http_200', 2, None),
        (f'audit#{USER}', 'seo-api', 'POST /api/seo/keywords/research', 'limit_reached', 1, 'daily limit 3'),
    ]


def test_uses_the_default_when_the_limit_cannot_be_read(monkeypatch):
    config = MagicMock()
    config.get_item.side_effect = ClientError({'Error': {'Code': 'AccessDeniedException', 'Message': ''}}, 'GetItem')

    assert seo_spend_limit.limit(config) == 100


def test_answers_the_callers_calls_today_and_the_limit(monkeypatch):
    limit = Limit(monkeypatch, 40)
    limit.counter.items[f'spend#{USER}#' + seo_spend_limit._today()] = {'calls': 15}

    calls = seo_spend_limit.daily_calls(USER)

    assert (calls.used, calls.limit, calls.remaining, calls.resets_at.endswith('T00:00:00Z')) == (15, 40, 25, True)
