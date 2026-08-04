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

    The router is loaded through the shared `keyword_mgmt_router` fixture in
    `lambda/api/conftest.py`, which sets the sub-handlers' import-time env vars,
    patches `boto3`, and seeds the router's `HandlerLoader` cache
    (`_handlers._cache`) with a distinct `MagicMock` per sub-handler filename.
    Dispatch is therefore asserted without executing the real promotion worker,
    without importing `promote-keywords.py` (which builds a `boto3` resource at
    module scope), and without reaching AWS.

Test outcomes:
    - `POST /api/keywords/promote` invokes `promote-keywords.py` exactly once and
      leaves `manage-keywords.py` / `get-keywords.py` untouched
    - the promotion route matches through either event field (`resource`, `path`,
      or both) and for `PUT` / `DELETE` as well, as the sibling routes do
    - `GET /api/keywords` without an `id` still reaches `get-keywords.py`
    - `POST /api/keywords` and `PUT` / `DELETE` / `GET /api/keywords/{id}` still
      reach `manage-keywords.py`
    - `/api/keyword-research*` still reaches `keyword-research.py`
    - `/api/keywords/promote-bogus` and friends do NOT reach the promotion
      handler; being segment children of `/api/keywords`, they keep their
      pre-existing `manage-keywords.py` dispatch
    - `/api/keywordspromote` and friends are children of no route at all, so
      they return a 404 with no sub-handler invoked
"""

import pytest

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
    """Dispatch cases for the new `/api/keywords/promote` route (Req 1.1)."""

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
    def test_routes_to_promote_keywords_when_other_method_on_promote_path(
        self, keyword_mgmt_router, method
    ):
        # Arrange
        mod, stubs = keyword_mgmt_router
        event = _request_event(_PROMOTE_PATH, _PROMOTE_PATH, method)

        # Act
        result = mod.handler(event, None)

        # Assert
        _assert_only_target_called(stubs, 'promote-keywords.py', event, result)


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
