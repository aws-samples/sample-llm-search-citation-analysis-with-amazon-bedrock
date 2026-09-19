"""API Gateway proxy events, and response decoding, for handler tests."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

LOCALHOST_ORIGIN_HEADERS: Mapping[str, str] = {'origin': 'http://localhost:3000'}


def api_gateway_event(
    method: str,
    path: str,
    *,
    body: Any = None,
    path_params: Mapping[str, str] | None = None,
    query: Mapping[str, str] | None = None,
    headers: Mapping[str, str] | None = None,
    claims: Mapping[str, Any] | None = None,
    resource: str | None = None,
) -> dict[str, Any]:
    """A minimal REST-proxy event as the routers see it.

    ``body`` is JSON-encoded unless ``None``; ``claims`` are placed where the
    Cognito authorizer puts them. ``resource`` and ``query`` are only emitted
    when given, matching the shapes the handlers' tests already used.
    """
    event: dict[str, Any] = {
        'httpMethod': method,
        'path': path,
        'pathParameters': dict(path_params) if path_params is not None else None,
        'headers': dict(LOCALHOST_ORIGIN_HEADERS if headers is None else headers),
        'body': None if body is None else json.dumps(body),
    }
    if resource is not None:
        event['resource'] = resource
    if query is not None:
        event['queryStringParameters'] = dict(query)
    if claims is not None:
        event['requestContext'] = {'authorizer': {'claims': dict(claims)}}
    return event


def parse_response(response: Mapping[str, Any]) -> tuple[int, Any]:
    """``(statusCode, decoded JSON body)`` of a Lambda proxy response."""
    return response['statusCode'], json.loads(response['body'])


def parse_response_lenient(response: Mapping[str, Any]) -> tuple[int, Any]:
    """``parse_response`` for responses that may omit either field.

    A missing ``statusCode`` reads as 200 and a missing or empty ``body`` as
    ``{}`` — the shapes a ``cors_preflight`` short-circuit or a bare handler
    stub returns. Prefer ``parse_response`` when the handler under test
    always answers with both.
    """
    raw = response.get('body')
    parsed = json.loads(raw) if isinstance(raw, str) and raw else {}
    return response.get('statusCode', 200), parsed
