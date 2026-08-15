"""
Router dispatch tests for the promotion route on the keyword-mgmt API Lambda.

Covers:
    - `POST /api/keywords/promote` dispatches to the `promote-keywords`
      sub-handler and NOT to `manage-keywords`
    - The pre-existing `/api/keywords` and `/api/keyword-research` dispatches are
      unchanged by the new, more specific route
    - Prefix collisions (`/api/keywords/promote-bogus`, `/api/keywordspromote`)
      do NOT reach the promotion handler

Context:
    `keyword-mgmt.py` routes by API Gateway `resource`/`path`.
    `/api/keywords/promote` is a child of the generic `/api/keywords` route, so
    without a dedicated check ahead of it a promotion POST would fall through to
    `manage-keywords.py` as a single-keyword create; these tests pin the
    ordering. The router is loaded through the `keyword_mgmt_router` fixture (the
    `_load_router` pattern from `test_routers_404.py`), which seeds the router's
    `HandlerLoader` cache with a distinct `MagicMock` per sub-handler, so
    dispatch is asserted without executing a real worker or reaching AWS.
"""

import importlib
import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# --- Import-boundary bootstrap ----------------------------------------------
#
# `keyword-mgmt.py` is hyphenated and its sub-handlers build AWS clients at
# import time, so it is loaded fresh via `spec_from_file_location` under a module
# name unique to THIS file (the `_load_router` pattern from `test_routers_404.py`)
# with the layer `shared` on `sys.path`, env vars set, and `boto3` patched BEFORE
# the load. The `HandlerLoader` cache is seeded with a `MagicMock` per
# sub-handler, so dispatch is asserted without executing a real worker or
# reaching AWS. Every global mutation is undone on teardown; nothing is autouse.

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.abspath(os.path.join(_API_DIR, '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')

_KEYWORD_MGMT_ROUTER_FILE = 'keyword-mgmt.py'
_KEYWORD_MGMT_MODULE_NAME = 'keyword_mgmt_under_test_promote_routing'
_TEST_TABLE_NAME = 'test-keywords-table'

# Env vars the keyword-mgmt sub-handlers read at import time. Set so no real AWS
# client could be built even if a sub-handler were ever loaded.
_KEYWORD_MGMT_ENV = {
    'KEYWORD_RESEARCH_TABLE': 'test-keyword-research-table',
    'SECRETS_PREFIX': 'test-citation-analysis/',
    'DYNAMODB_TABLE_KEYWORDS': _TEST_TABLE_NAME,
    'KEYWORDS_TABLE': _TEST_TABLE_NAME,
}

# Every sub-handler `keyword-mgmt.py` can dispatch to. Each is stubbed with a
# distinct result so a test can assert exactly which target ran.
_KEYWORD_MGMT_SUB_HANDLERS = (
    'keyword-research.py',
    'get-keywords.py',
    'manage-keywords.py',
    'promote-keywords.py',
)


def _load_keyword_mgmt_router():
    """Load `keyword-mgmt.py` fresh under this file's unique module name.

    `shared/__init__.py` re-exports `api_response` as a function, shadowing the
    submodule, so the real module object is bound explicitly.
    """
    if _LAYER_PY not in sys.path:
        sys.path.insert(0, _LAYER_PY)
    sys.modules['shared.api_response'] = importlib.import_module('shared.api_response')
    sys.modules.pop(_KEYWORD_MGMT_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _KEYWORD_MGMT_MODULE_NAME, os.path.join(_API_DIR, _KEYWORD_MGMT_ROUTER_FILE)
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def keyword_mgmt_router():
    """Fresh `keyword-mgmt.py` router with every sub-handler stubbed distinctly.

    Seeding the router's `HandlerLoader` cache means no real sub-handler file is
    loaded or executed. Yields `(module, stubs_by_filename)`.
    """
    saved = {name: os.environ.get(name) for name in _KEYWORD_MGMT_ENV}
    os.environ.update(_KEYWORD_MGMT_ENV)

    with (
        patch('boto3.resource', MagicMock(name='boto3.resource')),
        patch('boto3.client', MagicMock(name='boto3.client')),
    ):
        module = _load_keyword_mgmt_router()
        stubs = {}
        for name in _KEYWORD_MGMT_SUB_HANDLERS:
            stub = MagicMock(name=f'{name}_handler')
            stub.return_value = {'statusCode': 200, 'handler': name}
            module._handlers._cache[name] = stub
            stubs[name] = stub

        yield module, stubs

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
    sys.modules.pop(_KEYWORD_MGMT_MODULE_NAME, None)


_PROMOTE_PATH = '/api/keywords/promote'

# Paths that share a textual prefix with the PROMOTION route but are not it nor a
# segment child of it. They are still segment children of the generic
# `/api/keywords` route, so the pre-existing dispatch stands: a mutation goes to
# `manage-keywords.py`. The point of the guard is that the promotion handler is
# NOT reached.
_PROMOTE_COLLISION_PATHS = [
    '/api/keywords/promote-bogus',
    '/api/keywords/promoted',
    '/api/keywords/promote2',
]

# Paths that share a textual prefix with a route but are not a segment child of
# any, so they must match nothing and fall through to the 404. In the spirit of
# `_UNMATCHED_PATHS` in `lambda/api/test_routers_404.py`.
_UNMATCHED_COLLISION_PATHS = [
    '/api/keywordspromote',
    '/api/keywords-promote',
    '/api/keywords-bogus',
]


def _request_event(resource, path, method, path_parameters=None):
    """Build an API Gateway proxy event for a routing decision."""
    event = {
        'resource': resource,
        'path': path,
        'httpMethod': method,
        'headers': {},
    }
    if path_parameters is not None:
        event['pathParameters'] = path_parameters
    return event


def _assert_only_target_called(stubs, target, event, result):
    """Assert `target` handled `event` exclusively and returned its result."""
    stubs[target].assert_called_once_with(event, None)
    assert result == stubs[target].return_value, (
        f'{event["httpMethod"]} {event["path"]} did not return the {target} result'
    )
    for name, stub in stubs.items():
        if name != target:
            stub.assert_not_called()


# --- Promotion route -------------------------------------------------------


class TestPromoteRoutingUnit:
    """Dispatch cases for the new `/api/keywords/promote` route."""

    def test_routes_to_promote_keywords_when_post_to_promote_path(self, keyword_mgmt_router):
        # Arrange
        mod, stubs = keyword_mgmt_router
        event = _request_event(_PROMOTE_PATH, _PROMOTE_PATH, 'POST')

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(stubs, 'promote-keywords.py', event, result)
        stubs['manage-keywords.py'].assert_not_called()

    @pytest.mark.parametrize('field_mode', ['resource', 'path', 'both'])
    def test_routes_to_promote_keywords_when_promote_path_in_any_event_field(
        self, keyword_mgmt_router, field_mode
    ):
        # Arrange
        mod, stubs = keyword_mgmt_router
        event = _request_event(
            _PROMOTE_PATH if field_mode in ('resource', 'both') else '',
            _PROMOTE_PATH if field_mode in ('path', 'both') else '',
            'POST',
        )

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(stubs, 'promote-keywords.py', event, result)

    @pytest.mark.parametrize('method', ['PUT', 'DELETE'])
    def test_does_not_dispatch_when_other_method_targets_promote_path(
        self, keyword_mgmt_router, method
    ):
        # Arrange
        mod, stubs = keyword_mgmt_router
        event = _request_event(_PROMOTE_PATH, _PROMOTE_PATH, method)

        # Act
        result = mod.handler(event, None)

        # Assert
        assert result['statusCode'] == 400
        for stub in stubs.values():
            stub.assert_not_called()

    def test_returns_not_found_when_post_targets_promote_descendant(
        self, keyword_mgmt_router
    ):
        # Arrange
        mod, stubs = keyword_mgmt_router
        child_path = f'{_PROMOTE_PATH}/unexpected'
        event = _request_event(child_path, child_path, 'POST')

        # Act
        result = mod.handler(event, None)

        # Assert
        assert result['statusCode'] == 404
        for stub in stubs.values():
            stub.assert_not_called()


# --- Pre-existing routes ---------------------------------------------------


class TestExistingRoutingUnit:
    """The routes that existed before promotion must dispatch unchanged."""

    def test_routes_to_get_keywords_when_get_keywords_list_without_id(self, keyword_mgmt_router):
        # Arrange
        mod, stubs = keyword_mgmt_router
        event = _request_event('/api/keywords', '/api/keywords', 'GET', None)

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(stubs, 'get-keywords.py', event, result)

    def test_routes_to_manage_keywords_when_post_to_keywords_collection(self, keyword_mgmt_router):
        # Arrange
        mod, stubs = keyword_mgmt_router
        event = _request_event('/api/keywords', '/api/keywords', 'POST')

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(stubs, 'manage-keywords.py', event, result)

    @pytest.mark.parametrize('method', ['GET', 'PUT', 'DELETE'])
    def test_routes_to_manage_keywords_when_request_carries_a_keyword_id(
        self, keyword_mgmt_router, method
    ):
        # Arrange
        mod, stubs = keyword_mgmt_router
        event = _request_event(
            '/api/keywords/{id}', '/api/keywords/abc123', method, {'id': 'abc123'}
        )

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(stubs, 'manage-keywords.py', event, result)

    @pytest.mark.parametrize(
        'route_path',
        [
            '/api/keyword-research',
            '/api/keyword-research/expand',
            '/api/keyword-research/competitor',
            '/api/keyword-research/history',
        ],
    )
    def test_routes_to_keyword_research_when_research_path(self, keyword_mgmt_router, route_path):
        # Arrange
        mod, stubs = keyword_mgmt_router
        event = _request_event(route_path, route_path, 'POST')

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(stubs, 'keyword-research.py', event, result)


# --- Prefix collisions -----------------------------------------------------


class TestPromoteRoutingCollisionUnit:
    """Paths sharing a prefix with the promotion route must not match it."""

    @pytest.mark.parametrize('collision_path', _PROMOTE_COLLISION_PATHS)
    def test_routes_to_manage_keywords_when_promote_prefix_collision_path(
        self, keyword_mgmt_router, collision_path
    ):
        # Arrange
        mod, stubs = keyword_mgmt_router
        event = _request_event(collision_path, collision_path, 'POST')

        # Act
        result = mod.handler(event, None)

        # Assert
        # These are segment children of the generic /api/keywords route, so the
        # pre-existing mutation dispatch stands; only the promotion handler must
        # stay out of it.
        _assert_only_target_called(stubs, 'manage-keywords.py', event, result)

    @pytest.mark.parametrize('collision_path', _UNMATCHED_COLLISION_PATHS)
    def test_returns_not_found_when_path_is_no_route_child(
        self, keyword_mgmt_router, collision_path
    ):
        # Arrange
        mod, stubs = keyword_mgmt_router
        event = _request_event(collision_path, collision_path, 'POST')

        # Act
        result = mod.handler(event, None)

        # Assert
        assert result.get('statusCode') == 404, (
            f'prefix-collision path {collision_path} did not return not-found'
        )
        for stub in stubs.values():
            stub.assert_not_called()
