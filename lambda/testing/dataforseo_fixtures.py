"""Test doubles for ``shared.dataforseo_client``: envelope builders and a scripted transport.

Usage::

    transport = install_transport(monkeypatch, ok_envelope([{'keyword': 'example'}], cost=0.0132))
    result = dataforseo_client.post_live('/v3/dataforseo_labs/google/keyword_ideas/live', {...})
    transport.calls[0].task  # the posted task

Every response is a ``(http_status, body)`` pair or an exception instance the transport raises; an envelope
dict is sent as HTTP 200 with its JSON body.
"""

from __future__ import annotations

import io
import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import pytest

from shared import dataforseo_client
from testing.dynamodb_stubs import conditional_check_failure

TEST_LOGIN = 'api@example.com'
TEST_STORED_KEY = f'{TEST_LOGIN}:example-pass'
"""What ``get_api_key('dataforseo-key')`` returns in tests (``login:password``)."""
LABS_IDEAS_PATH = '/v3/dataforseo_labs/google/keyword_ideas/live'
LABS_IDEAS_TASK: dict[str, Any] = {'keywords': ['example shoes'], 'location_code': 2840, 'language_code': 'en'}
"""A Labs call and its task, for transport tests that do not care about the endpoint."""


def ok_envelope(items: Sequence[Any] | None = None, cost: float = 0.0, *, result: list[Any] | None = None,
                data: dict[str, Any] | None = None, path: Sequence[str] = ('v3', 'test', 'live'),
                status_code: int = 20000, **result_fields: Any) -> dict[str, Any]:
    """A successful response; ``result`` wins, else ``result = [{'items': items, **result_fields}]``."""
    task_result = result if result is not None else [{'items': list(items or []), **result_fields}]
    return {
        'status_code': 20000,
        'status_message': 'Ok.',
        'tasks': [{
            'id': 'task-1',
            'status_code': status_code,
            'status_message': 'Ok.',
            'path': list(path),
            'cost': cost,
            'data': data or {},
            'result': task_result,
        }],
    }


def task_error_envelope(status_code: int, message: str, cost: float | None = None, *,
                        data: dict[str, Any] | None = None) -> dict[str, Any]:
    """HTTP 200 with a successful top level and one failed task (``cost`` omitted when ``None``)."""
    task: dict[str, Any] = {
        'id': 'task-1',
        'status_code': status_code,
        'status_message': message,
        'path': ['v3', 'test', 'live'],
        'data': data or {},
        'result': None,
    }
    if cost is not None:
        task['cost'] = cost
    return {'status_code': 20000, 'status_message': 'Ok.', 'tasks': [task]}


def top_level_error(status_code: int = 50000, message: str = 'Internal Server Error.') -> dict[str, Any]:
    """A response whose top-level ``status_code`` failed (no tasks)."""
    return {'status_code': status_code, 'status_message': message, 'tasks': []}


def user_data_envelope(login: str = TEST_LOGIN, balance: float | None = 42.5) -> dict[str, Any]:
    """The free ``GET /v3/appendix/user_data`` answer."""
    money: dict[str, Any] = {'total': 50.0}
    if balance is not None:
        money['balance'] = balance
    return ok_envelope(result=[{'login': login, 'timezone': 'UTC', 'money': money}],
                       path=('v3', 'appendix', 'user_data'))


@dataclass(frozen=True)
class SentRequest:
    """One request the scripted transport received."""

    method: str
    url: str
    headers: dict[str, str]
    body: bytes | None
    timeout_s: float

    @property
    def task(self) -> dict[str, Any]:
        """The single task of a POST body."""
        assert self.body is not None
        tasks = json.loads(self.body)
        assert isinstance(tasks, list)
        assert len(tasks) == 1
        return tasks[0]


Response = tuple[int, str] | dict[str, Any] | BaseException


@dataclass
class ScriptedTransport:
    """A stand-in for ``dataforseo_client._send`` that answers from a script, in order."""

    responses: list[Response]
    calls: list[SentRequest] = field(default_factory=list)

    def __call__(self, method: str, url: str, headers: dict[str, str], body: bytes | None,
                 timeout_s: float) -> tuple[int, str]:
        self.calls.append(SentRequest(method, url, dict(headers), body, timeout_s))
        assert self.responses, 'the scripted transport ran out of responses'
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        if isinstance(response, dict):
            return 200, json.dumps(response)
        return response


def install_transport(monkeypatch: pytest.MonkeyPatch, *responses: Response,
                      stored_key: str | None = TEST_STORED_KEY) -> ScriptedTransport:
    """Point the DataForSEO client at a scripted transport, a stored key and an instant retry sleep."""
    transport = ScriptedTransport(list(responses))
    monkeypatch.setattr(dataforseo_client, '_send', transport)
    monkeypatch.setattr(dataforseo_client, 'get_api_key', lambda _name: stored_key)
    monkeypatch.setattr(dataforseo_client, '_sleep', lambda _seconds: None)
    return transport


@dataclass
class InMemoryCacheTable:
    """A ``CitationAnalysis-SeoCache`` table stand-in that honours ``seo_cache``'s conditional put.

    The condition (write only when absent, expired or empty) is evaluated in Python against ``now``, the
    ``:now`` value the caller passes, so tests exercise the real overwrite rule end to end.
    """

    items: dict[str, dict[str, Any]] = field(default_factory=dict)

    def get_item(self, Key: dict[str, str]) -> dict[str, Any]:
        item = self.items.get(Key['cache_key'])
        return {'Item': dict(item)} if item is not None else {}

    def put_item(self, Item: dict[str, Any], **condition: Any) -> None:
        existing = self.items.get(Item['cache_key'])
        if condition and existing is not None:
            now = condition['ExpressionAttributeValues'][':now']
            if existing['expires_at'] > now and existing['empty'] is not True:
                raise conditional_check_failure('PutItem')
        self.items[Item['cache_key']] = dict(Item)


@dataclass
class InMemoryBucket:
    """An S3 client stand-in holding objects by key (``put_object`` / ``get_object`` only)."""

    objects: dict[str, bytes] = field(default_factory=dict)

    def put_object(self, Bucket: str, Key: str, Body: bytes, **_extra: Any) -> None:
        self.objects[f'{Bucket}/{Key}'] = Body

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        return {'Body': io.BytesIO(self.objects[f'{Bucket}/{Key}'])}


__all__ = [
    'LABS_IDEAS_PATH',
    'LABS_IDEAS_TASK',
    'TEST_LOGIN',
    'TEST_STORED_KEY',
    'InMemoryBucket',
    'InMemoryCacheTable',
    'ScriptedTransport',
    'SentRequest',
    'install_transport',
    'ok_envelope',
    'task_error_envelope',
    'top_level_error',
    'user_data_envelope',
]
