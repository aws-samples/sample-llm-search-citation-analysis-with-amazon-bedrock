"""
Unit tests for shared.decorators — the wrapper-contract invariants.

Every decorator in the module wraps a handler as
``(event, context, *args, **kwargs)`` and forwards both untouched. This file
exists because that contract was violated silently: ``parse_json_body`` and
``validate`` dropped ``*args`` while ``require_group`` forwarded them, so
``PUT /api/query-prompts/{id}`` — which dispatches
``update_prompt(event, context, prompt_id)`` — raised TypeError and returned a
500 to administrators. No test covered the composition, so the whole suite
stayed green while the route had never worked.

The tests below pin the contract per decorator and then for the full stack, so
a future decorator that forgets ``*args`` fails here rather than in production.
"""

from __future__ import annotations

import importlib
import json
import os
import sys
from typing import Any

import pytest

# The shared package __init__ re-exports api_response as a function, which can
# shadow the submodule. Point sys.path at lambda/ so `import shared.decorators`
# resolves to the in-repo module.
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_LAMBDA_DIR = os.path.join(_REPO, 'lambda')
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

decorators = importlib.import_module('shared.decorators')
auth = importlib.import_module('shared.auth')

api_handler = decorators.api_handler
cors_preflight = decorators.cors_preflight
paginate = decorators.paginate
parse_json_body = decorators.parse_json_body
route_handler = decorators.route_handler
validate = decorators.validate
require_group = auth.require_group

PATH_PARAM = 'prompt-42'


def make_event(
    method: str = 'PUT',
    body: dict[str, Any] | None = None,
    path: str = '/api/query-prompts/prompt-42',
    groups: str = 'Admin',
) -> dict[str, Any]:
    """Build an API Gateway REST event with Cognito authorizer claims."""
    return {
        'httpMethod': method,
        'path': path,
        'pathParameters': {'id': PATH_PARAM},
        'headers': {'origin': 'http://localhost:3000'},
        'body': json.dumps(body) if body is not None else None,
        'requestContext': {'authorizer': {'claims': {
            'cognito:username': 'admin@example.com',
            'cognito:groups': groups,
        }}},
    }


def parse_response(result: dict[str, Any]) -> tuple[int, Any]:
    """Extract status code and parsed body from a Lambda response."""
    raw = result.get('body')
    parsed = json.loads(raw) if isinstance(raw, str) and raw else {}
    return result.get('statusCode', 200), parsed


def echo_positional(event: dict[str, Any], context: Any, received: str, **kwargs) -> dict[str, Any]:
    """Handler that only succeeds if a positional argument survived the stack."""
    return {'statusCode': 200, 'body': json.dumps({'received': received})}


class TestPositionalArgumentForwarding:
    """
    Each decorator must pass a caller's positional argument through untouched.

    Parametrized one decorator at a time so a failure names the culprit rather
    than just reporting that the stack is broken.
    """

    @pytest.mark.parametrize(
        ('name', 'decorate'),
        [
            ('api_handler', lambda fn: api_handler(fn)),
            ('parse_json_body', lambda fn: parse_json_body(fn)),
            ('validate', lambda fn: validate({})(fn)),
            ('cors_preflight', lambda fn: cors_preflight(fn)),
            ('paginate', lambda fn: paginate()(fn)),
            ('require_group', lambda fn: require_group('Admin')(fn)),
        ],
    )
    def test_decorator_forwards_a_positional_argument(self, name, decorate) -> None:
        gated = decorate(echo_positional)

        status, body = parse_response(gated(make_event(body={}), None, PATH_PARAM))

        assert status == 200, f"{name} dropped the positional argument"
        assert body['received'] == PATH_PARAM

    def test_route_handler_forwards_a_positional_argument(self) -> None:
        """`route_handler` dispatches rather than calling the wrapped function."""
        @route_handler({('PUT', None): echo_positional})
        def handler(event, context, *args, **kwargs):
            pass

        status, body = parse_response(handler(make_event(), None, PATH_PARAM))

        assert status == 200
        assert body['received'] == PATH_PARAM


class TestFullStackComposition:
    """
    The exact stack that was broken in production.

    `manage-query-prompts.handler` calls `update_prompt(event, context,
    prompt_id)`, and `update_prompt` carries require_group + parse_json_body +
    validate. Every layer has to forward the positional argument.
    """

    def test_admin_stack_delivers_both_positional_and_injected_arguments(self) -> None:
        @require_group('Admin')
        @parse_json_body
        @validate({'name': {'type': str, 'max_length': 100, 'source': 'body'}})
        def update_thing(event, context, thing_id, body, name) -> dict[str, Any]:
            return {'statusCode': 200, 'body': json.dumps({
                'thing_id': thing_id,
                'name': name,
                'body_keys': sorted(body),
            })}

        result = update_thing(make_event(body={'name': 'Renamed'}), None, PATH_PARAM)
        status, payload = parse_response(result)

        assert status == 200
        assert payload['thing_id'] == PATH_PARAM
        assert payload['name'] == 'Renamed'

    def test_gate_still_denies_before_the_positional_argument_matters(self) -> None:
        """Forwarding must not have weakened the authorization check."""
        @require_group('Admin')
        @parse_json_body
        def update_thing(event, context, thing_id, body) -> dict[str, Any]:
            return {'statusCode': 200, 'body': '{}'}

        result = update_thing(
            make_event(body={'name': 'x'}, groups='Users'), None, PATH_PARAM
        )
        status, _ = parse_response(result)

        assert status == 403

    def test_paginate_and_parse_json_body_coexist_with_a_positional_argument(self) -> None:
        """`manage-users` stacks @paginate; nothing may collide with *args."""
        @paginate(default_limit=25)
        @parse_json_body
        def list_thing(event, context, thing_id, body, limit, offset, sort_by, sort_order):
            return {'statusCode': 200, 'body': json.dumps({
                'thing_id': thing_id,
                'limit': limit,
            })}

        status, payload = parse_response(
            list_thing(make_event(body={}), None, PATH_PARAM)
        )

        assert status == 200
        assert payload['limit'] == 25


class TestKeywordOnlyCallsStillWork:
    """The overwhelmingly common case: no positional arguments at all."""

    def test_stack_works_without_positional_arguments(self) -> None:
        @api_handler
        @cors_preflight
        @require_group('Admin')
        @parse_json_body
        @validate({'name': {'required': True, 'type': str, 'source': 'body'}})
        def create_thing(event, context, body, name) -> dict[str, Any]:
            return {'statusCode': 201, 'body': json.dumps({'name': name})}

        status, payload = parse_response(
            create_thing(make_event(method='POST', body={'name': 'Fresh'}), None)
        )

        assert status == 201
        assert payload['name'] == 'Fresh'

    def test_preflight_short_circuits_above_the_gate(self) -> None:
        @api_handler
        @cors_preflight
        @require_group('Admin')
        def mutate(event, context) -> dict[str, Any]:
            return {'statusCode': 200, 'body': '{}'}

        event = {'httpMethod': 'OPTIONS', 'headers': {'origin': 'http://localhost:3000'}}
        status, _ = parse_response(mutate(event, None))

        assert status == 200

    def test_validation_failure_still_returns_400_with_a_positional_argument(self) -> None:
        @require_group('Admin')
        @parse_json_body
        @validate({'name': {'required': True, 'type': str, 'source': 'body'}})
        def update_thing(event, context, thing_id, body, name) -> dict[str, Any]:
            return {'statusCode': 200, 'body': '{}'}

        status, payload = parse_response(
            update_thing(make_event(body={}), None, PATH_PARAM)
        )

        assert status == 400
        assert payload['field'] == 'name'
