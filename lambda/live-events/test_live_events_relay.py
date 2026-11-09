"""The relay: one signed publish per routed event, a raise on a refused publish, nothing for an unrouted event."""

from __future__ import annotations

import json
import os
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest
from botocore.credentials import Credentials
from live_channel_routes import ChannelMessage

from shared.change_events import VIEW_JOB_FINISHED
from testing.live_events_fixtures import STATE_MACHINE_TOPICS, WORKFLOW, change_event, execution_status_event
from testing.module_loader import load_handler_module

_relay = load_handler_module(os.path.dirname(__file__), 'handler.py', 'live_events_relay_under_test')

_DOMAIN = 'abc123.appsync-api.us-east-1.amazonaws.com'


class FakeHttp:
    """Answers every request with ``status`` and ``body`` and keeps what was sent."""

    def __init__(self, status: int = 200, body: dict[str, Any] | None = None) -> None:
        self.status = status
        self.body = body if body is not None else {'failed': [], 'successful': [{'identifier': 'i', 'index': 0}]}
        self.sent: list[dict[str, Any]] = []

    def request(self, method: str, url: str, *, body: bytes, headers: dict[str, str]) -> SimpleNamespace:
        self.sent.append({'method': method, 'url': url, 'body': json.loads(body), 'headers': headers})
        return SimpleNamespace(status=self.status, data=json.dumps(self.body).encode())


@pytest.fixture
def relay_env(monkeypatch):
    monkeypatch.setenv('EVENTS_HTTP_DOMAIN', _DOMAIN)
    monkeypatch.setenv('AWS_REGION', 'us-east-1')
    monkeypatch.setenv('STATE_MACHINE_TOPICS', json.dumps(STATE_MACHINE_TOPICS))
    _relay._state_machine_topics.cache_clear()
    session = SimpleNamespace(get_credentials=lambda: Credentials('AKIDEXAMPLE', 'secret', 'token'))
    with patch.object(_relay.boto3, 'Session', return_value=session):
        yield
    _relay._state_machine_topics.cache_clear()


def _relay_with(http: FakeHttp, event: dict[str, Any]) -> dict[str, Any]:
    with patch.object(_relay, '_http', return_value=http):
        return _relay.handler(event, None)


@pytest.mark.usefixtures('relay_env')
def test_a_routed_event_is_published_once_as_one_json_event_on_its_channel():
    http = FakeHttp()

    result = _relay_with(http, change_event(VIEW_JOB_FINISHED, {'job_id': 'j1', 'status': 'done'}))

    assert result == {'status': 'published', 'channel': '/deployment/view-jobs'}
    assert [(sent['method'], sent['url']) for sent in http.sent] == [('POST', f'https://{_DOMAIN}/event')]
    body = http.sent[0]['body']
    assert body['channel'] == '/deployment/view-jobs'
    assert [json.loads(event) for event in body['events']] == [{'type': 'view-job.finished', 'job_id': 'j1', 'status': 'done'}]


@pytest.mark.usefixtures('relay_env')
def test_the_publish_is_signed_for_appsync_with_the_session_token():
    http = FakeHttp()

    _relay_with(http, execution_status_event(WORKFLOW, 'RUNNING'))

    headers = {name.lower(): value for name, value in http.sent[0]['headers'].items()}
    assert headers['authorization'].startswith('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/')
    assert '/us-east-1/appsync/aws4_request' in headers['authorization']
    assert headers['x-amz-security-token'] == 'token'
    assert headers['host'] == _DOMAIN


@pytest.mark.usefixtures('relay_env')
@pytest.mark.parametrize('http', [FakeHttp(status=401, body={}), FakeHttp(body={'failed': [{'index': 0}], 'successful': []})],
                         ids=['refused', 'event failed'])
def test_a_publish_appsync_does_not_accept_raises_so_the_invocation_is_retried(http):
    with pytest.raises(_relay.RelayPublishError, match='/deployment/runs'):
        _relay_with(http, execution_status_event(WORKFLOW, 'FAILED'))


@pytest.mark.usefixtures('relay_env')
def test_an_event_no_channel_hears_is_dropped_without_a_request():
    http = FakeHttp()

    assert _relay_with(http, execution_status_event('Elsewhere', 'RUNNING')) == {'status': 'dropped'}
    assert http.sent == []


@pytest.mark.usefixtures('relay_env')
def test_no_credentials_raises_before_any_request():
    http = FakeHttp()
    with patch.object(_relay.boto3, 'Session', return_value=SimpleNamespace(get_credentials=lambda: None)), \
            pytest.raises(_relay.RelayPublishError, match='no credentials'):
        _relay_with(http, execution_status_event(WORKFLOW, 'RUNNING'))
    assert http.sent == []


def test_the_signed_request_carries_the_channel_and_one_compact_event():
    routed = ChannelMessage('/deployment/runs', {'type': 'execution.status', 'status': 'RUNNING'})

    request = _relay.signed_publish_request(_DOMAIN, 'eu-west-1', routed, Credentials('AKID', 'secret'))

    assert json.loads(request.body) == {'channel': '/deployment/runs', 'events': ['{"type":"execution.status","status":"RUNNING"}']}
    assert '/eu-west-1/appsync/aws4_request' in request.headers['Authorization']


def test_a_malformed_topic_map_routes_no_state_machine(monkeypatch):
    monkeypatch.setenv('STATE_MACHINE_TOPICS', '["not", "a", "map"]')
    _relay._state_machine_topics.cache_clear()
    try:
        assert _relay._state_machine_topics() == {}
    finally:
        _relay._state_machine_topics.cache_clear()
