"""
Router dispatch tests for the promotion route on the keyword-mgmt API Lambda.

Covers:
    - `POST /api/keywords/promote` dispatches to the `promote-keywords`
      sub-handler and NOT to `manage-keywords` (**Validates: Requirements 1.1**)
    - The pre-existing `/api/keywords` and `/api/keyword-research` dispatches are
      unchanged by the new, more specific route
    - Prefix collisions (`/api/keywords/promote-bogus`, `/api/keywordspromote`)
      do NOT reach the promotion handler

Context:
    `keyword-mgmt.py` routes by API Gateway `resource` / `path` through
    `shared.router.path_matches_route`. `/api/keywords/promote` is a child of the
    generic `/api/keywords` route, so without a dedicated check ahead of it a
    promotion POST would fall through to `manage-keywords.py` and be treated as a
    single-keyword create. These tests pin the ordering.

    Sub-handlers load lazily through the router's `shared.router.HandlerLoader`
    instance (`_handlers`), so each test seeds `_handlers._cache` with a distinct
    `MagicMock` per sub-handler filename. Dispatch is therefore asserted without
    executing the real promotion worker, without importing
    `promote-keywords.py` (which builds a `boto3` resource at module scope), and
    without reaching AWS. `boto3` is patched for this module's tests anyway, and
    the env vars the sub-handlers read at import time are set, so no real client
    can be constructed even if a module were loaded.

    The router file is hyphenated and cannot be imported normally: it is loaded
    fresh through `importlib.util.spec_from_file_location` under a unique module
    name, following `_load_router` in `lambda/api/test_routers_404.py`.

Test outcomes:
    - `POST /api/keywords/promote` invokes `promote-keywords.py` exactly once and
      leaves `manage-keywords.py` / `get-keywords.py` untouched
    - `PUT` / `DELETE` on the promotion path also reach `promote-keywords.py`
      (the route is matched by path, as the sibling routes are)
    - `GET /api/keywords` without an `id` still reaches `get-keywords.py`
    - `POST /api/keywords` and `PUT` / `DELETE /api/keywords/{id}` still reach
      `manage-keywords.py`
    - `/api/keyword-research*` still reaches `keyword-research.py`
    - `/api/keywords/promote-bogus` and friends do NOT reach the promotion
      handler; being segment children of `/api/keywords`, they keep their
      pre-existing `manage-keywords.py` dispatch
    - `/api/keywordspromote` and friends are children of no route at all, so
      they return a 404 with no sub-handler invoked
"""

import importlib
import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# --- Test bootstrap (import boundary) --------------------------------------

# The router does `sys.path.insert(0, '/opt/python')` then imports from
# `shared`. Point the layer directory at the front of sys.path so `shared`
# resolves to the layer copy (the copy loaded in Lambda via /opt/python).
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')
if _LAYER_PY not in sys.path:
    sys.path.insert(0, _LAYER_PY)

# shared/__init__.py re-exports api_response as a function, shadowing the
# submodule — use import_module to get the real module object.
_layer_api_response = importlib.import_module('shared.api_response')
sys.modules['shared.api_response'] = _layer_api_response

_API_DIR = os.path.dirname(os.path.abspath(__file__))

_ROUTER_FILE = 'keyword-mgmt.py'
# Distinct from the module names used by the other keyword-mgmt test modules so
# they cannot evict each other's copy in the same pytest session.
_MODULE_NAME = 'keyword_mgmt_promote_routing_under_test'

# Every sub-handler the router can dispatch to. Each is stubbed with a distinct
# result so a test can assert exactly which target ran.
_SUB_HANDLER_FILES = (
    'keyword-research.py',
    'get-keywords.py',
    'manage-keywords.py',
    'promote-keywords.py',
)

# Env vars the sub-handlers read at module import time. Set so that no real AWS
# client could be built even if a sub-handler were ever loaded.
_REQUIRED_ENV = {
    'KEYWORD_RESEARCH_TABLE': 'test-keyword-research-table',
    'SECRETS_PREFIX': 'test-citation-analysis/',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords-table',
    'KEYWORDS_TABLE': 'test-keywords-table',
}

_PROMOTE_PATH = '/api/keywords/promote'

# Paths that share a textual prefix with the PROMOTION route but are not it nor
# a segment child of it. They are still segment children of the generic
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


@pytest.fixture(scope='module', autouse=True)
def _mock_boto3():
    """Patch boto3 for every test in this module.

    Applied inside a `with` block wrapping the `yield` so the patch is always
    undone and cannot leak into other test modules in the same pytest session.
    """
    with (
        patch('boto3.resource', MagicMock(name='boto3.resource')),
        patch('boto3.client', MagicMock(name='boto3.client')),
    ):
        yield


@pytest.fixture(autouse=True)
def _clean_env():
    """Save, set, and restore the env vars the sub-handlers read at import."""
    saved = {name: os.environ.get(name) for name in _REQUIRED_ENV}
    os.environ.update(_REQUIRED_ENV)

    yield

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value


def _load_keyword_mgmt():
    """Load the hyphenated `keyword-mgmt.py` router as a fresh module."""
    sys.modules.pop(_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _MODULE_NAME, os.path.join(_API_DIR, _ROUTER_FILE)
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _install_all_handler_mocks(mod):
    """Seed the router's HandlerLoader cache with a distinct stub per sub-handler.

    Seeding `_handlers._cache` means no real sub-handler file is ever loaded or
    executed. Returns the stubs keyed by filename.
    """
    mocks = {}
    for name in _SUB_HANDLER_FILES:
        sub_mock = MagicMock(name=f'{name}_handler')
        sub_mock.return_value = {'statusCode': 200, 'handler': name}
        mod._handlers._cache[name] = sub_mock
        mocks[name] = sub_mock
    return mocks


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


def _assert_only_target_called(mocks, target, event, result):
    """Assert `target` handled `event` exclusively and returned its result."""
    mocks[target].assert_called_once_with(event, None)
    assert result == mocks[target].return_value, (
        f'{event["httpMethod"]} {event["path"]} did not return the {target} result'
    )
    for name, sub_mock in mocks.items():
        if name != target:
            sub_mock.assert_not_called()


@pytest.fixture
def keyword_mgmt():
    """Fresh keyword-mgmt router with every sub-handler stubbed distinctly."""
    mod = _load_keyword_mgmt()
    return mod, _install_all_handler_mocks(mod)


# --- Promotion route -------------------------------------------------------


class TestPromoteRoutingUnit:
    """Dispatch cases for the new `/api/keywords/promote` route (Req 1.1)."""

    def test_routes_to_promote_keywords_when_post_to_promote_path(self, keyword_mgmt):
        # Arrange
        mod, mocks = keyword_mgmt
        event = _request_event(_PROMOTE_PATH, _PROMOTE_PATH, 'POST')

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(mocks, 'promote-keywords.py', event, result)

    def test_does_not_route_to_manage_keywords_when_post_to_promote_path(self, keyword_mgmt):
        # Arrange
        mod, mocks = keyword_mgmt
        event = _request_event(_PROMOTE_PATH, _PROMOTE_PATH, 'POST')

        # Act
        mod.handler(event, None)

        # Assert
        mocks['manage-keywords.py'].assert_not_called()

    @pytest.mark.parametrize('field_mode', ['resource', 'path', 'both'])
    def test_routes_to_promote_keywords_when_promote_path_in_any_event_field(
        self, keyword_mgmt, field_mode
    ):
        # Arrange
        mod, mocks = keyword_mgmt
        event = _request_event(
            _PROMOTE_PATH if field_mode in ('resource', 'both') else '',
            _PROMOTE_PATH if field_mode in ('path', 'both') else '',
            'POST',
        )

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(mocks, 'promote-keywords.py', event, result)

    @pytest.mark.parametrize('method', ['PUT', 'DELETE'])
    def test_routes_to_promote_keywords_when_other_method_on_promote_path(
        self, keyword_mgmt, method
    ):
        # Arrange
        mod, mocks = keyword_mgmt
        event = _request_event(_PROMOTE_PATH, _PROMOTE_PATH, method)

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(mocks, 'promote-keywords.py', event, result)


# --- Pre-existing routes ---------------------------------------------------


class TestExistingRoutingUnit:
    """The routes that existed before promotion must dispatch unchanged."""

    def test_routes_to_get_keywords_when_get_keywords_list_without_id(self, keyword_mgmt):
        # Arrange
        mod, mocks = keyword_mgmt
        event = _request_event('/api/keywords', '/api/keywords', 'GET', None)

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(mocks, 'get-keywords.py', event, result)

    def test_routes_to_manage_keywords_when_post_to_keywords_collection(self, keyword_mgmt):
        # Arrange
        mod, mocks = keyword_mgmt
        event = _request_event('/api/keywords', '/api/keywords', 'POST')

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(mocks, 'manage-keywords.py', event, result)

    @pytest.mark.parametrize('method', ['PUT', 'DELETE'])
    def test_routes_to_manage_keywords_when_mutation_on_keyword_id(self, keyword_mgmt, method):
        # Arrange
        mod, mocks = keyword_mgmt
        event = _request_event(
            '/api/keywords/{id}', '/api/keywords/abc123', method, {'id': 'abc123'}
        )

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(mocks, 'manage-keywords.py', event, result)

    def test_routes_to_manage_keywords_when_get_bears_path_parameter_id(self, keyword_mgmt):
        # Arrange
        mod, mocks = keyword_mgmt
        event = _request_event(
            '/api/keywords/{id}', '/api/keywords/abc123', 'GET', {'id': 'abc123'}
        )

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(mocks, 'manage-keywords.py', event, result)

    @pytest.mark.parametrize(
        'route_path',
        [
            '/api/keyword-research',
            '/api/keyword-research/expand',
            '/api/keyword-research/competitor',
            '/api/keyword-research/history',
        ],
    )
    def test_routes_to_keyword_research_when_research_path(self, keyword_mgmt, route_path):
        # Arrange
        mod, mocks = keyword_mgmt
        event = _request_event(route_path, route_path, 'POST')

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(mocks, 'keyword-research.py', event, result)


# --- Prefix collisions -----------------------------------------------------


class TestPromoteRoutingCollisionUnit:
    """Paths sharing a prefix with the promotion route must not match it."""

    @pytest.mark.parametrize('collision_path', _PROMOTE_COLLISION_PATHS)
    def test_routes_to_manage_keywords_when_promote_prefix_collision_path(
        self, keyword_mgmt, collision_path
    ):
        # Arrange
        mod, mocks = keyword_mgmt
        event = _request_event(collision_path, collision_path, 'POST')

        # Act
        result = mod.handler(event, None)

        # Assert
        # These are segment children of the generic /api/keywords route, so the
        # pre-existing mutation dispatch stands; only the promotion handler must
        # stay out of it.
        _assert_only_target_called(mocks, 'manage-keywords.py', event, result)

    @pytest.mark.parametrize('collision_path', _UNMATCHED_COLLISION_PATHS)
    def test_returns_not_found_when_path_is_no_route_child(self, keyword_mgmt, collision_path):
        # Arrange
        mod, mocks = keyword_mgmt
        event = _request_event(collision_path, collision_path, 'POST')

        # Act
        result = mod.handler(event, None)

        # Assert
        assert result.get('statusCode') == 404, (
            f'prefix-collision path {collision_path} did not return not-found'
        )
        for sub_mock in mocks.values():
            sub_mock.assert_not_called()
