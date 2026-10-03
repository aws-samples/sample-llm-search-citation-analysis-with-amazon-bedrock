"""
Routing tests for the consolidated keyword-mgmt API Lambda.

`keyword-mgmt.handler` routes purely by API Gateway `resource` / `path`:
`/api/keyword-research*` -> keyword-research, `/api/keyword-groups*` ->
manage-keyword-groups, `POST /api/keywords/promote` -> promote-keywords,
`GET /api/keywords` without an `id` -> get-keywords, every other
`/api/keywords*` request -> manage-keywords, and anything else -> not-found.

Keyword research used to run in the background by having this function invoke
itself with flag-only events (`async_expand` / `async_competitor`), which the
router had to special-case. Since 2.2.0 the research work runs in its own
Step Functions state machine, so no event without a path ever reaches this
router and there is nothing to special-case: a flag-only event is just an
unmatched route.

Sub-handlers load lazily through `shared.router.HandlerLoader` (`_handlers`),
so the router is loaded through `testing.keyword_mgmt_fixtures`, which seeds
`_handlers._cache[...]` with a distinct MagicMock per sub-handler to assert
dispatch without executing the real handlers or reaching AWS.
"""

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from testing.keyword_mgmt_fixtures import (
    assert_dispatched_only_to,
    assert_nothing_dispatched,
    keyword_mgmt_router_fixture,
    load_stubbed_keyword_mgmt,
)

_MODULE_NAME = 'keyword_mgmt_router_under_test'

keyword_mgmt_all = keyword_mgmt_router_fixture(_MODULE_NAME)


# --- Event strategies -------------------------------------------------------

_ROUTE_METHODS = st.sampled_from(['GET', 'POST', 'PUT', 'DELETE'])


def _with_route(draw, route_path):
    """Build an event carrying `route_path` in resource, path, or both.

    API Gateway populates `resource` (template) and `path` (concrete); the
    router matches either, so all three field modes must route identically.
    """
    mode = draw(st.sampled_from(['resource', 'path', 'both']))
    event = {}
    if mode in ('resource', 'both'):
        event['resource'] = route_path
    if mode in ('path', 'both'):
        event['path'] = route_path
    return event


# keyword-research: resource/path under /api/keyword-research.
_KEYWORD_RESEARCH_PATHS = [
    '/api/keyword-research',
    '/api/keyword-research/expand',
    '/api/keyword-research/competitor',
    '/api/keyword-research/history',
    '/api/keyword-research/abc123',
]


@st.composite
def _keyword_research_events(draw):
    event = _with_route(draw, draw(st.sampled_from(_KEYWORD_RESEARCH_PATHS)))
    event['httpMethod'] = draw(_ROUTE_METHODS)
    return event


# get-keywords: GET /api/keywords with no `id` path parameter.
@st.composite
def _get_keywords_events(draw):
    event = _with_route(draw, '/api/keywords')
    event['httpMethod'] = 'GET'
    path_params = draw(st.sampled_from([None, {}, {'foo': 'bar'}]))
    if path_params is not None:
        event['pathParameters'] = path_params
    return event


# manage-keywords: mutation (POST/PUT/DELETE) under /api/keywords, OR any
# request bearing pathParameters.id.
_KEYWORDS_PATHS = ['/api/keywords', '/api/keywords/abc', '/api/keywords/123']


@st.composite
def _manage_keywords_events(draw):
    event = _with_route(draw, draw(st.sampled_from(_KEYWORDS_PATHS)))
    if draw(st.sampled_from(['mutation', 'id'])) == 'mutation':
        event['httpMethod'] = draw(st.sampled_from(['POST', 'PUT', 'DELETE']))
    else:
        # An `id` path parameter routes to manage-keywords for ANY method,
        # including GET.
        event['httpMethod'] = draw(_ROUTE_METHODS)
        event['pathParameters'] = {'id': draw(st.text(min_size=1))}
    return event


# not-found: an unmatched route, including prefix collisions
# (`/api/keywords-bogus`) that must NOT match a real route, and the flag-only
# events the retired self-invoke path used to send.
_UNMATCHED_PATHS = [
    '/api/keywords-bogus',
    '/api/keyword-research-bogus',
    '/api/keyword',
    '/api/other',
    '/health',
    '/api',
    '',
]


_RETIRED_ASYNC_FLAGS = st.sampled_from(['async_expand', 'async_competitor'])


@st.composite
def _not_found_events(draw):
    route_path = draw(st.sampled_from(_UNMATCHED_PATHS))
    if route_path:
        event = _with_route(draw, route_path)
    else:
        event = {}
    event['httpMethod'] = draw(_ROUTE_METHODS)
    if draw(st.booleans()):
        event[draw(_RETIRED_ASYNC_FLAGS)] = True
    return event


# Each event is paired with its routing target (sub-handler filename), or
# None for the not-found fallback.
_routing_cases = st.one_of(
    _keyword_research_events().map(lambda e: (e, 'keyword-research.py')),
    _get_keywords_events().map(lambda e: (e, 'get-keywords.py')),
    _manage_keywords_events().map(lambda e: (e, 'manage-keywords.py')),
    _not_found_events().map(lambda e: (e, None)),
)


# --- Property-based tests ---------------------------------------------------


class TestRoutingProperty:
    """
    For any event, `keyword-mgmt.handler` dispatches by path alone:
    `/api/keyword-research` -> keyword-research, `GET /api/keywords` without
    `id` -> get-keywords, mutations / `id` under `/api/keywords` ->
    manage-keywords, and unmatched routes -> not-found (statusCode 404) —
    including the flag-only events the retired self-invoke path used to send,
    which no longer bypass path routing.
    """

    @settings(max_examples=100)
    @given(case=_routing_cases)
    def test_routes_to_the_target_the_path_selects(self, case):
        # Arrange
        event, expected_target = case
        mod, mocks = load_stubbed_keyword_mgmt(_MODULE_NAME)

        # Act
        result = mod.handler(event, None)

        # Assert
        if expected_target is None:
            assert result.get('statusCode') == 404, (
                f"unmatched event {event!r} did not return not-found"
            )
            assert_nothing_dispatched(mocks)
        else:
            assert_dispatched_only_to(mocks, expected_target, event, result)


# --- Example / unit tests ---------------------------------------------------


class TestRoutingUnit:
    """Explicit cases for each route."""

    @pytest.mark.parametrize(
        ('event', 'target'),
        [
            ({'resource': '/api/keyword-research', 'path': '/api/keyword-research', 'httpMethod': 'POST'}, 'keyword-research.py'),
            ({'resource': '/api/keywords', 'path': '/api/keywords', 'httpMethod': 'GET', 'pathParameters': None}, 'get-keywords.py'),
            ({'resource': '/api/keywords', 'path': '/api/keywords', 'httpMethod': 'POST'}, 'manage-keywords.py'),
            (
                {'resource': '/api/keywords/{id}', 'path': '/api/keywords/abc123', 'httpMethod': 'GET', 'pathParameters': {'id': 'abc123'}},
                'manage-keywords.py',
            ),
        ],
        ids=[
            'research-path-to-keyword-research',
            'keywords-list-without-id-to-get-keywords',
            'mutation-under-keywords-to-manage-keywords',
            'path-parameter-id-to-manage-keywords',
        ],
    )
    def test_routes_to_the_handler_the_route_selects(self, keyword_mgmt_all, event, target):
        mod, mocks = keyword_mgmt_all

        result = mod.handler(event, None)

        assert_dispatched_only_to(mocks, target, event, result)

    @pytest.mark.parametrize(
        'event',
        [
            # The self-invoke payloads (no resource/path) no longer reach any handler.
            {'async_expand': True, 'research_id': 'abc', 'seed_keyword': 'running shoes'},
            {'resource': '/api/keywords-bogus', 'path': '/api/keywords-bogus', 'httpMethod': 'GET'},
        ],
        ids=['retired-async-flag-only', 'unmatched-prefix-collision-route'],
    )
    def test_returns_not_found_without_dispatching(self, keyword_mgmt_all, event):
        mod, mocks = keyword_mgmt_all

        result = mod.handler(event, None)

        assert result.get('statusCode') == 404
        assert_nothing_dispatched(mocks)



class TestKeywordGroupsRouting:
    """`/api/keyword-groups*` is a sibling of `/api/keywords`, never a child."""

    @pytest.mark.parametrize(
        ('method', 'path', 'path_params'),
        [
            ('GET', '/api/keyword-groups', None),
            ('POST', '/api/keyword-groups', None),
            ('PUT', '/api/keyword-groups/g1', {'id': 'g1'}),
            ('DELETE', '/api/keyword-groups/g1', {'id': 'g1'}),
            ('PUT', '/api/keyword-groups/g1/keywords', {'id': 'g1'}),
        ],
    )
    def test_routes_every_keyword_groups_method_to_the_groups_handler(self, keyword_mgmt_all, method, path, path_params):
        mod, mocks = keyword_mgmt_all
        resource = path.replace('/g1', '/{id}')
        event = {'resource': resource, 'path': path, 'httpMethod': method, 'pathParameters': path_params}

        result = mod.handler(event, None)

        assert_dispatched_only_to(mocks, 'manage-keyword-groups.py', event, result)

    def test_keeps_keyword_routes_away_from_the_groups_handler(self, keyword_mgmt_all):
        mod, mocks = keyword_mgmt_all
        event = {'resource': '/api/keywords', 'path': '/api/keywords', 'httpMethod': 'GET', 'pathParameters': None}

        mod.handler(event, None)

        mocks['manage-keyword-groups.py'].assert_not_called()
        mocks['get-keywords.py'].assert_called_once_with(event, None)
