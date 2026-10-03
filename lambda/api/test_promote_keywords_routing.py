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
    ordering. The router is loaded through the `keyword_mgmt_router` fixture
    (`testing.keyword_mgmt_fixtures`), which seeds the router's `HandlerLoader`
    cache with a distinct `MagicMock` per sub-handler, so dispatch is asserted
    without executing a real worker or reaching AWS.
"""

import pytest

from testing.keyword_mgmt_fixtures import (
    assert_dispatched_only_to,
    assert_nothing_dispatched,
    keyword_mgmt_router_fixture,
)

keyword_mgmt_router = keyword_mgmt_router_fixture('keyword_mgmt_under_test_promote_routing')


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


def _dispatch(router, resource, path, method, path_parameters=None):
    """Send an API Gateway proxy event through ``router``; returns ``(event, result, stubs)``."""
    mod, stubs = router
    event = {
        'resource': resource,
        'path': path,
        'httpMethod': method,
        'headers': {},
    }
    if path_parameters is not None:
        event['pathParameters'] = path_parameters
    return event, mod.handler(event, None), stubs


# --- Promotion route -------------------------------------------------------


class TestPromoteRoutingUnit:
    """Dispatch cases for the new `/api/keywords/promote` route."""

    def test_routes_to_promote_keywords_when_post_to_promote_path(self, keyword_mgmt_router):
        event, result, stubs = _dispatch(keyword_mgmt_router, _PROMOTE_PATH, _PROMOTE_PATH, 'POST')

        assert_dispatched_only_to(stubs, 'promote-keywords.py', event, result)
        stubs['manage-keywords.py'].assert_not_called()

    @pytest.mark.parametrize('field_mode', ['resource', 'path', 'both'])
    def test_routes_to_promote_keywords_when_promote_path_in_any_event_field(
        self, keyword_mgmt_router, field_mode
    ):
        event, result, stubs = _dispatch(
            keyword_mgmt_router,
            _PROMOTE_PATH if field_mode in ('resource', 'both') else '',
            _PROMOTE_PATH if field_mode in ('path', 'both') else '',
            'POST',
        )

        assert_dispatched_only_to(stubs, 'promote-keywords.py', event, result)

    @pytest.mark.parametrize('method', ['PUT', 'DELETE'])
    def test_does_not_dispatch_when_other_method_targets_promote_path(
        self, keyword_mgmt_router, method
    ):
        _event, result, stubs = _dispatch(keyword_mgmt_router, _PROMOTE_PATH, _PROMOTE_PATH, method)

        assert result['statusCode'] == 400
        assert_nothing_dispatched(stubs)

    def test_returns_not_found_when_post_targets_promote_descendant(
        self, keyword_mgmt_router
    ):
        child_path = f'{_PROMOTE_PATH}/unexpected'

        _event, result, stubs = _dispatch(keyword_mgmt_router, child_path, child_path, 'POST')

        assert result['statusCode'] == 404
        assert_nothing_dispatched(stubs)


# --- Pre-existing routes ---------------------------------------------------


class TestExistingRoutingUnit:
    """The routes that existed before promotion must dispatch unchanged."""

    @pytest.mark.parametrize(
        ('resource', 'path', 'method', 'path_parameters', 'target'),
        [
            ('/api/keywords', '/api/keywords', 'GET', None, 'get-keywords.py'),
            ('/api/keywords', '/api/keywords', 'POST', None, 'manage-keywords.py'),
            ('/api/keywords/{id}', '/api/keywords/abc123', 'GET', {'id': 'abc123'}, 'manage-keywords.py'),
            ('/api/keywords/{id}', '/api/keywords/abc123', 'PUT', {'id': 'abc123'}, 'manage-keywords.py'),
            ('/api/keywords/{id}', '/api/keywords/abc123', 'DELETE', {'id': 'abc123'}, 'manage-keywords.py'),
            ('/api/keyword-research', '/api/keyword-research', 'POST', None, 'keyword-research.py'),
            ('/api/keyword-research/expand', '/api/keyword-research/expand', 'POST', None, 'keyword-research.py'),
            ('/api/keyword-research/competitor', '/api/keyword-research/competitor', 'POST', None, 'keyword-research.py'),
            ('/api/keyword-research/history', '/api/keyword-research/history', 'POST', None, 'keyword-research.py'),
        ],
        ids=[
            'get-keywords-list-without-id-to-get-keywords',
            'post-to-keywords-collection-to-manage-keywords',
            'get-with-keyword-id-to-manage-keywords',
            'put-with-keyword-id-to-manage-keywords',
            'delete-with-keyword-id-to-manage-keywords',
            'research-root-to-keyword-research',
            'research-expand-to-keyword-research',
            'research-competitor-to-keyword-research',
            'research-history-to-keyword-research',
        ],
    )
    def test_routes_to_the_pre_existing_handler_of_the_route(
        self, keyword_mgmt_router, resource, path, method, path_parameters, target
    ):
        event, result, stubs = _dispatch(keyword_mgmt_router, resource, path, method, path_parameters)

        assert_dispatched_only_to(stubs, target, event, result)


# --- Prefix collisions -----------------------------------------------------


class TestPromoteRoutingCollisionUnit:
    """Paths sharing a prefix with the promotion route must not match it."""

    @pytest.mark.parametrize('collision_path', _PROMOTE_COLLISION_PATHS)
    def test_routes_to_manage_keywords_when_promote_prefix_collision_path(
        self, keyword_mgmt_router, collision_path
    ):
        event, result, stubs = _dispatch(keyword_mgmt_router, collision_path, collision_path, 'POST')

        # These are segment children of the generic /api/keywords route, so the
        # pre-existing mutation dispatch stands; only the promotion handler must
        # stay out of it.
        assert_dispatched_only_to(stubs, 'manage-keywords.py', event, result)

    @pytest.mark.parametrize('collision_path', _UNMATCHED_COLLISION_PATHS)
    def test_returns_not_found_when_path_is_no_route_child(
        self, keyword_mgmt_router, collision_path
    ):
        _event, result, stubs = _dispatch(keyword_mgmt_router, collision_path, collision_path, 'POST')

        assert result.get('statusCode') == 404, (
            f'prefix-collision path {collision_path} did not return not-found'
        )
        assert_nothing_dispatched(stubs)
