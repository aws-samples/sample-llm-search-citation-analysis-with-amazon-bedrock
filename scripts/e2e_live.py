"""
Shared support of the live end-to-end checks (``scripts/e2e_*.py``): call a deployed API Lambda with an Admin API
Gateway event, so the route's own validation runs as from the dashboard, and report each step.

No Cognito token is needed: the caller's AWS credentials invoke the Lambda directly (``lambda:InvokeFunction``).
"""

from __future__ import annotations

import json
from typing import Any

import boto3

ADMIN_CLAIMS = {'cognito:groups': 'Admin', 'cognito:username': 'e2e-admin', 'sub': 'e2e-admin', 'email': 'e2e@example.com'}


class E2EFailureError(Exception):
    """A step answered something other than what the dashboard relies on."""


def api_event(method: str, path: str, body: dict[str, Any] | None = None, *, resource: str | None = None,
              path_params: dict[str, str] | None = None, query: dict[str, str] | None = None) -> dict[str, Any]:
    """An Admin API Gateway proxy event for ``path`` (``resource`` defaults to the path itself)."""
    return {
        'httpMethod': method,
        'path': path,
        'resource': resource or path,
        'pathParameters': path_params,
        'queryStringParameters': query,
        'headers': {'Content-Type': 'application/json', 'origin': 'https://e2e.invalid'},
        'body': None if body is None else json.dumps(body),
        'requestContext': {'authorizer': {'claims': ADMIN_CLAIMS}},
    }


class LiveApi:
    """The deployed API Lambdas of one region."""

    def __init__(self, region: str) -> None:
        self._client = boto3.client('lambda', region_name=region)

    def call(self, function: str, event: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        """``(statusCode, decoded body)`` of one invocation (the ``data`` envelope unwrapped)."""
        payload = self._client.invoke(FunctionName=function, Payload=json.dumps(event).encode())['Payload'].read()
        answer = json.loads(payload)
        body = json.loads(answer.get('body') or '{}')
        return int(answer.get('statusCode', 0)), body.get('data', body) if isinstance(body, dict) else {'body': body}


def expect(step: str, status: int, body: dict[str, Any], wanted: int) -> dict[str, Any]:
    """``body`` when ``status`` is ``wanted``; raises ``E2EFailureError`` otherwise."""
    if status != wanted:
        raise E2EFailureError(f'{step}: expected HTTP {wanted}, got {status} {body}')
    print(f'ok   {step} (HTTP {status})')
    return body


def require(step: str, condition: bool, detail: object) -> None:
    """Raises ``E2EFailureError`` naming ``step`` unless ``condition`` holds."""
    if not condition:
        raise E2EFailureError(f'{step}: {detail}')
    print(f'ok   {step}')
