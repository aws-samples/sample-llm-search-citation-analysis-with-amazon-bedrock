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
from testing.dataforseo_fixtures import install_daily_limit, install_transport, ok_envelope
from testing.events import parse_response
from testing.seo_fixtures import seo_event

USER = 'admin@example.com'
LABS = '/v3/dataforseo_labs/google/keyword_ideas/live'


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
    limit = install_daily_limit(monkeypatch, 2)

    answers = [ask(making(1))[0] for _ in range(3)]
    status, body = ask(making(1))

    assert (answers, status, body['code'], len(transport.calls)) == ([200, 200, 429], 429, 'DAILY_LIMIT', 2)
    assert limit.counter.calls_of(USER) == 2


def test_counts_each_billed_call_of_a_request(monkeypatch, transport):
    limit = install_daily_limit(monkeypatch, 100)

    ask(making(3))

    assert limit.counter.calls_of(USER) == 3


def test_stops_a_request_at_the_call_that_would_pass_the_limit(monkeypatch, transport):
    limit = install_daily_limit(monkeypatch, 2)

    status, _body = ask(making(3))

    assert (status, len(transport.calls), limit.counter.calls_of(USER)) == (429, 2, 2)


def test_sends_no_paid_call_when_an_admin_set_the_limit_to_zero(monkeypatch, transport):
    install_daily_limit(monkeypatch, 0)

    status, body = ask(making(1))

    assert (status, body['code'], transport.calls) == (429, 'DAILY_LIMIT', [])


def test_allows_100_calls_a_day_when_no_limit_is_set(monkeypatch, transport):
    limit = install_daily_limit(monkeypatch, None)
    limit.counter.items[f'spend#{USER}#' + seo_spend_limit._today()] = {'calls': 99}

    assert (ask(making(1))[0], ask(making(1))[0]) == (200, 429)


def test_counts_nothing_for_an_answer_read_from_the_cache(monkeypatch, transport):
    limit = install_daily_limit(monkeypatch, 1)

    assert (ask(making(0))[0], limit.counter.calls_of(USER)) == (200, 0)


def test_does_not_meter_a_free_route(monkeypatch, transport):
    limit = install_daily_limit(monkeypatch, 0)
    event = seo_event('GET', '/api/seo/seo-geo')

    status, _body = parse_response(seo_spend_limit.limited(making(1))(event, None))

    assert (status, limit.audit_items()) == (200, [])


def test_counts_an_export_read_against_the_exports_owner(monkeypatch, transport):
    limit = install_daily_limit(monkeypatch, 5)

    ask(making(1), '/api/seo/domains/overview', {'cognito:username': 'export-service', 'custom:export_owner': 'alice'})

    assert (limit.counter.calls_of('alice'), limit.counter.calls_of('export-service')) == (1, 0)


def test_audits_each_paid_request_with_who_what_how_and_its_calls(monkeypatch, transport):
    limit = install_daily_limit(monkeypatch, 3)

    ask(making(2))
    ask(making(2))

    assert [(item['pk'], item['tool'], item['operation'], item['outcome'], item['calls'], item.get('reason'))
            for item in limit.audit_items()] == [
        (f'audit#{USER}', 'seo-api', 'POST /api/seo/keywords/research', 'http_200', 2, None),
        (f'audit#{USER}', 'seo-api', 'POST /api/seo/keywords/research', 'http_429', 1,
         'daily limit of 3 calls reached: a billed call was not sent'),
    ]


def test_uses_the_default_when_the_limit_cannot_be_read(monkeypatch):
    config = MagicMock()
    config.get_item.side_effect = ClientError({'Error': {'Code': 'AccessDeniedException', 'Message': ''}}, 'GetItem')

    assert seo_spend_limit.limit(config) == 100


def test_answers_the_callers_calls_today_and_the_limit(monkeypatch):
    limit = install_daily_limit(monkeypatch, 40)
    limit.counter.items[f'spend#{USER}#' + seo_spend_limit._today()] = {'calls': 15}

    calls = seo_spend_limit.daily_calls(USER)

    assert (calls.used, calls.limit, calls.remaining, calls.resets_at.endswith('T00:00:00Z')) == (15, 40, 25, True)


def queuing(calls: int) -> Callable[[dict[str, Any], Any], dict[str, Any]]:
    """A sub-handler that queues ``calls`` billed calls for the jobs Lambda, as a rank grid or a Lighthouse run does."""
    def route(event: dict[str, Any], _context: Any) -> dict[str, Any]:
        seo_spend_limit.reserve_queued_calls(calls, 'a queued job')
        return success_response({'queued': calls}, event, 202)

    return seo_http.seo_errors(route)


def test_counts_the_queued_calls_of_a_job_all_at_once(monkeypatch):
    limit = install_daily_limit(monkeypatch, 30)

    assert (ask(queuing(25), '/api/seo/local/jobs')[0], limit.counter.calls_of(USER)) == (202, 25)


def test_refuses_a_job_whose_queued_calls_do_not_fit_and_counts_none(monkeypatch):
    limit = install_daily_limit(monkeypatch, 30)
    ask(queuing(25), '/api/seo/local/jobs')

    status, body = ask(queuing(9), '/api/seo/local/jobs')

    assert (status, body['code'], limit.counter.calls_of(USER)) == (429, 'DAILY_LIMIT', 25)


def test_audits_a_paid_request_whose_handler_raised(monkeypatch, transport):
    limit = install_daily_limit(monkeypatch, 5)

    def failing(event: dict[str, Any], _context: Any) -> dict[str, Any]:
        post_live(LABS, {'keywords': ['x']})
        raise RuntimeError('a bug after a billed call')

    with pytest.raises(RuntimeError):
        ask(failing)

    assert [(item['outcome'], item['calls']) for item in limit.audit_items()] == [('http_500', 1)]
