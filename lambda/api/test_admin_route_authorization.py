"""
Exhaustive coverage that the Admin gate is *applied* to every mutating route.

`lambda/shared/test_auth.py` proves `require_group` works. It cannot prove the
decorator is present on a given handler — deleting a `@require_group` line from
`manage-providers.py` would have failed nothing, and that is the route whose
Lambda role holds prefix-wide read *and* write over every provider secret
(AUDIT-2026-08-19 §0.3).

This file closes that hole with one table. Every mutating admin route across all
seven handler modules is listed below and must:

1. Return 403 for an authenticated caller in the wrong group.
2. Return 403 for an authenticated caller with no group claim at all — the
   shape an invited read-only user actually has.
3. Touch no AWS client while denying. A 403 returned after
   `admin_add_user_to_group` or `put_secret_value` already succeeded would be
   no fix at all.

Adding a mutating route without adding it here is the failure mode this guards:
the table is the checklist. The per-module test files
(`test_manage_users_authz.py`, `test_manage_schedule.py`,
`test_manage_query_prompts.py`) cover the allow paths and per-route semantics;
this file only asserts uniform denial.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from typing import Any, NamedTuple
from unittest.mock import MagicMock, patch

import pytest

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.dirname(_API_DIR)

# Make `from shared.xxx import` resolve (the layer puts shared/ at /opt/python/).
#
# `os.path.abspath` matters: an unnormalized `lambda/api/..` entry here makes
# Python resolve the `shared` package through it, so every `shared` submodule
# gets an unnormalized `__file__`. `shared/test_keyword_identity.py` derives its
# fixture path with `Path(__file__).parents[2]`, which does not collapse `..`,
# and would look for `test-fixtures/` under `lambda/api/`. This file is
# alphabetically first in `lambda/api/`, so it is the one that imports `shared`
# first and fixes the package path for the whole session.
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

# Env each module needs to import. All modules fail fast on missing table names,
# and CORS_ORIGIN_PARAM='' keeps `get_cors_origin` from reaching SSM.
_SHARED_ENV = {
    'CORS_ORIGIN_PARAM': '',
    'STATE_MACHINE_ARN': 'arn:aws:states:us-east-1:123456789012:stateMachine:test',
    'SCHEDULE_ROLE_ARN': 'arn:aws:iam::123456789012:role/test-scheduler-role',
    'USER_POOL_ID': 'us-east-1_testpool',
    'DYNAMODB_TABLE_PROVIDER_CONFIG': 'test-provider-config',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brand-config',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_QUERY_PROMPTS': 'test-query-prompts',
    'QUERY_PROMPTS_TABLE': 'test-query-prompts',
}


class Route(NamedTuple):
    """One mutating admin route, addressed the way API Gateway would."""

    module: str
    method: str
    path: str
    path_params: dict[str, str] | None = None
    body: dict[str, Any] | None = None

    def __str__(self) -> str:
        """Readable pytest parametrize id."""
        return f'{self.method} {self.path}'


# Every mutating admin route in the system. Grouped by module for review.
MUTATING_ADMIN_ROUTES = [
    # manage-users.py — the whole surface is Admin-only, reads included.
    Route('manage-users.py', 'POST', '/api/users', body={'email': 'new@example.com'}),
    Route('manage-users.py', 'PUT', '/api/users/victim@example.com',
          {'username': 'victim@example.com'}, {'groups': ['Admin']}),
    Route('manage-users.py', 'DELETE', '/api/users/victim@example.com',
          {'username': 'victim@example.com'}),
    Route('manage-users.py', 'POST', '/api/users/victim@example.com/reset-password',
          {'username': 'victim@example.com'}),

    # manage-providers.py — §0.3, writes Secrets Manager.
    Route('manage-providers.py', 'PUT', '/api/providers/openai',
          {'id': 'openai'}, {'enabled': False}),
    Route('manage-providers.py', 'POST', '/api/providers/openai/validate',
          {'id': 'openai'}, {'api_key': 'sk-not-a-real-key'}),

    # manage-brand-config.py — persistence plus three Bedrock-spend routes.
    Route('manage-brand-config.py', 'POST', '/api/brand-config', body={'industry': 'hotels'}),
    Route('manage-brand-config.py', 'PUT', '/api/brand-config', body={'industry': 'hotels'}),
    Route('manage-brand-config.py', 'DELETE', '/api/brand-config'),
    Route('manage-brand-config.py', 'POST', '/api/brand-config/expand',
          body={'brand_name': 'Acme'}),
    Route('manage-brand-config.py', 'POST', '/api/brand-config/expand-all',
          body={'existing_brands': ['Acme']}),
    Route('manage-brand-config.py', 'POST', '/api/brand-config/find-competitors',
          body={'first_party_brands': ['Acme']}),

    # manage-schedule.py — recurring spend.
    Route('manage-schedule.py', 'POST', '/api/schedules',
          body={'frequency': 'daily', 'time': '09:00'}),
    Route('manage-schedule.py', 'DELETE', '/api/schedules/daily-analysis',
          {'name': 'daily-analysis'}),

    # manage-query-prompts.py — each persona multiplies every run's spend.
    Route('manage-query-prompts.py', 'POST', '/api/query-prompts',
          body={'name': 'P', 'template': 'about {keyword}'}),
    Route('manage-query-prompts.py', 'PUT', '/api/query-prompts/abc',
          {'id': 'abc'}, {'name': 'Renamed'}),
    Route('manage-query-prompts.py', 'DELETE', '/api/query-prompts/abc', {'id': 'abc'}),
    Route('manage-query-prompts.py', 'PATCH', '/api/query-prompts/abc', {'id': 'abc'}),

    # Both trigger handlers — unbounded provider spend per request.
    Route('trigger-analysis.py', 'POST', '/api/trigger-analysis'),
    Route('trigger-keyword-analysis.py', 'POST', '/api/trigger-keyword-analysis',
          body={'keywords': ['hotels']}),
]


class LoadedModule(NamedTuple):
    """A handler module plus the single mock every AWS call lands on."""

    module: Any
    aws: MagicMock


def _load(filename: str) -> LoadedModule:
    """Import a hyphenated handler module with every AWS client mocked.

    `boto3.client` and `boto3.resource` both return the *same* MagicMock, so
    "did this request touch AWS at all?" is a single `method_calls` check.
    """
    aws = MagicMock()
    # Real exception classes: handlers use these in `except` clauses, and a
    # MagicMock attribute is not catchable.
    aws.exceptions.UserNotFoundException = type('UserNotFoundException', (Exception,), {})
    aws.exceptions.InvalidParameterException = type('InvalidParameterException', (Exception,), {})
    aws.exceptions.ResourceNotFoundException = type('ResourceNotFoundException', (Exception,), {})
    aws.exceptions.ConflictException = type('ConflictException', (Exception,), {})

    spec = importlib.util.spec_from_file_location(
        filename.replace('-', '_').removesuffix('.py'),
        os.path.join(_API_DIR, filename),
    )
    module = importlib.util.module_from_spec(spec)

    with patch('boto3.client', side_effect=lambda *a, **k: aws), \
         patch('boto3.resource', side_effect=lambda *a, **k: aws), \
         patch.dict(os.environ, _SHARED_ENV):
        spec.loader.exec_module(module)

    return LoadedModule(module, aws)


# Imported once per session; the reset fixture clears call records per test.
_MODULES = {filename: _load(filename) for filename in {r.module for r in MUTATING_ADMIN_ROUTES}}


@pytest.fixture(autouse=True)
def _reset_aws_mocks():
    """Clear recorded AWS calls so each test's assertion is about its own request."""
    for loaded in _MODULES.values():
        loaded.aws.reset_mock()


def make_event(route: Route, groups: str | None) -> dict[str, Any]:
    """Build an API Gateway event for `route` from a caller in `groups`."""
    claims: dict[str, Any] = {
        'sub': '11111111-2222-3333-4444-555555555555',
        'cognito:username': 'reader@example.com',
        'email': 'reader@example.com',
    }
    if groups is not None:
        claims['cognito:groups'] = groups

    return {
        'httpMethod': route.method,
        'path': route.path,
        'resource': route.path,
        'pathParameters': route.path_params,
        'headers': {'origin': 'http://localhost:3000'},
        'body': json.dumps(route.body) if route.body is not None else None,
        'requestContext': {'authorizer': {'claims': claims}},
    }


def call(route: Route, groups: str | None) -> tuple[int, MagicMock]:
    """Invoke the route's handler and return its status plus the AWS mock."""
    loaded = _MODULES[route.module]
    result = loaded.module.handler(make_event(route, groups), {})
    return result.get('statusCode', 200), loaded.aws


@pytest.mark.parametrize('route', MUTATING_ADMIN_ROUTES, ids=str)
class TestEveryMutatingRouteRequiresAdmin:
    """One class, three invariants, applied to all 20 mutating admin routes."""

    def test_denies_a_caller_in_the_wrong_group(self, route: Route) -> None:
        status, _ = call(route, groups='Users')

        assert status == 403

    def test_denies_a_caller_with_no_group_claim(self, route: Route) -> None:
        """An invited read-only user has no `cognito:groups` at all."""
        status, _ = call(route, groups=None)

        assert status == 403

    def test_touches_no_aws_service_while_denying(self, route: Route) -> None:
        """
        The gate must short-circuit before any read or write. This is what
        distinguishes a real refusal from a 403 rendered after the damage.
        """
        _, aws = call(route, groups='Users')

        assert aws.method_calls == []


class TestSuiteCoversEveryHandlerModule:
    """
    Guards the table above against silently shrinking.

    If a route entry is deleted, the parametrized tests still pass — there is
    just less coverage. These assertions make that visible.
    """

    def test_covers_all_seven_admin_handler_modules(self) -> None:
        assert sorted({route.module for route in MUTATING_ADMIN_ROUTES}) == [
            'manage-brand-config.py',
            'manage-providers.py',
            'manage-query-prompts.py',
            'manage-schedule.py',
            'manage-users.py',
            'trigger-analysis.py',
            'trigger-keyword-analysis.py',
        ]

    def test_covers_every_mutating_http_method(self) -> None:
        assert sorted({route.method for route in MUTATING_ADMIN_ROUTES}) == [
            'DELETE', 'PATCH', 'POST', 'PUT',
        ]

    def test_every_route_is_a_state_changing_method(self) -> None:
        """A GET slipping into this table would weaken the 'no AWS calls' claim."""
        assert [r for r in MUTATING_ADMIN_ROUTES if r.method == 'GET'] == []
