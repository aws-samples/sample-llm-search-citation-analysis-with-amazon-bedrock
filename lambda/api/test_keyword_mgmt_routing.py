"""
Routing tests for the consolidated keyword-mgmt API Lambda.

Covers:
    - Property 1 (Bug Condition): async self-invocation events
      (`async_expand` / `async_competitor`, with no API Gateway
      `resource` / `path`) are dispatched to the `keyword-research`
      sub-handler by `keyword-mgmt.handler`.

Context:
    The deployed entry point is `keyword-mgmt.handler`, which currently
    routes exclusively by `resource` / `path` via `path_matches_route`.
    Async self-invocation events produced by `_expand_keywords` /
    `_analyze_competitor` carry only the flags `async_expand` /
    `async_competitor` and no `resource` / `path`, so they match no route
    and fall through to `not_found_response`. The worker
    (`_process_expand_sync` / `_process_competitor_sync`) never runs and the
    DynamoDB record stays `pending` forever.

    Sub-handlers load lazily through `shared.router.HandlerLoader`
    (`_handlers`), so these tests seed `_handlers._cache['keyword-research.py']`
    with a MagicMock to assert dispatch without executing the real worker or
    reaching AWS / AI providers. boto3 is patched for the duration of this
    module's tests and required env vars are set so no real AWS clients are
    created.

Test outcomes:
    - EXPECTED ON UNFIXED CODE: these tests FAIL. Async events return a 404
      not-found response and the `keyword-research` mock is never called,
      confirming path-only routing cannot match flag-only events.
    - After the fix (async-detection guard in `keyword-mgmt.handler`): async
      events dispatch to the `keyword-research` sub-handler and return its
      result, never a not-found response.
"""

import importlib
import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# --- Test bootstrap (import boundary) --------------------------------------

# Point the layer directory at the front of sys.path so `shared` resolves to
# the layer copy the routers load in Lambda via /opt/python.
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')
if _LAYER_PY not in sys.path:
    sys.path.insert(0, _LAYER_PY)

# shared/__init__.py re-exports api_response as a function, shadowing the
# submodule — use import_module to get the real module object.
_layer_api_response = importlib.import_module('shared.api_response')
sys.modules['shared.api_response'] = _layer_api_response

_API_DIR = os.path.dirname(os.path.abspath(__file__))

# Required env vars must exist before `keyword-research.py` is ever imported
# (it reads `KEYWORD_RESEARCH_TABLE` and `SECRETS_PREFIX` at module level).
os.environ.setdefault('KEYWORD_RESEARCH_TABLE', 'test-keyword-research-table')
os.environ.setdefault('SECRETS_PREFIX', 'test-citation-analysis/')


@pytest.fixture(scope='module', autouse=True)
def _mock_boto3():
    """Patch boto3 for every test in this module.

    Ensures no real AWS clients are created if a sub-handler module is ever
    loaded during a test. Scoped to this module (rather than started at
    import time and never stopped) so the patch is guaranteed to be undone
    and cannot leak into other test modules in the same pytest session.
    """
    with (
        patch('boto3.resource', MagicMock(name='boto3.resource')),
        patch('boto3.client', MagicMock(name='boto3.client')),
    ):
        yield


def _load_keyword_mgmt():
    """Load `keyword-mgmt.py` (hyphenated name) as a fresh module."""
    module_name = 'keyword_mgmt_router_under_test'
    sys.modules.pop(module_name, None)
    spec = importlib.util.spec_from_file_location(
        module_name, os.path.join(_API_DIR, 'keyword-mgmt.py')
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _install_keyword_research_mock(mod):
    """Seed the router's HandlerLoader cache with a stub keyword-research handler.

    Returns the MagicMock so the caller can assert dispatch. Seeding the cache
    means the real `keyword-research.py` is never loaded or executed.
    """
    research_mock = MagicMock(name='keyword_research_handler')
    research_mock.return_value = {'status': 'completed'}
    mod._handlers._cache['keyword-research.py'] = research_mock
    return research_mock


@pytest.fixture
def keyword_mgmt():
    """Fresh keyword-mgmt router module with a stubbed keyword-research handler."""
    mod = _load_keyword_mgmt()
    research_mock = _install_keyword_research_mock(mod)
    return mod, research_mock


@pytest.fixture(autouse=True)
def _clean_env():
    """Ensure required env vars are present and restored around each test."""
    keys = ('KEYWORD_RESEARCH_TABLE', 'SECRETS_PREFIX')
    prev = {k: os.environ.get(k) for k in keys}
    os.environ['KEYWORD_RESEARCH_TABLE'] = 'test-keyword-research-table'
    os.environ['SECRETS_PREFIX'] = 'test-citation-analysis/'
    yield
    for k, v in prev.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


# --- Hypothesis strategies --------------------------------------------------

# Async self-invocation events: at least one async flag truthy and NO
# resource/path (exactly the payloads produced by _expand_keywords /
# _analyze_competitor).
_async_expand_events = st.fixed_dictionaries({
    'async_expand': st.just(True),
    'research_id': st.text(),
    'seed_keyword': st.text(),
    'industry': st.text(),
    'count': st.integers(min_value=1, max_value=50),
})

_async_competitor_events = st.fixed_dictionaries({
    'async_competitor': st.just(True),
    'research_id': st.text(),
    'url': st.text(),
    'domain': st.text(),
})

_async_events = st.one_of(_async_expand_events, _async_competitor_events)


# --- Property-based tests ---------------------------------------------------


class TestAsyncDispatchProperty:
    """
    **Property 1: Async events are dispatched to the keyword-research handler**

    **Validates: Requirements 2.1, 2.2**

    For any event where the bug condition holds (`async_expand` or
    `async_competitor` truthy), `keyword-mgmt.handler` must forward the event
    to the `keyword-research` sub-handler (returning that handler's result)
    before evaluating any path-based route, and must NOT return a not-found
    (statusCode 404) response.
    """

    @settings(max_examples=50)
    @given(event=_async_events)
    def test_dispatches_to_keyword_research_when_async_flag_present(self, event):
        # Arrange
        mod = _load_keyword_mgmt()
        research_mock = _install_keyword_research_mock(mod)

        # Act
        result = mod.handler(event, None)

        # Assert
        research_mock.assert_called_once_with(event, None)
        assert result == research_mock.return_value, (
            f"async event {event!r} did not return the keyword-research result"
        )
        assert result.get('statusCode') != 404, (
            f"async event {event!r} returned a not-found response (bug)"
        )


class TestAsyncDispatchUnit:
    """Concrete example cases for async dispatch (see design Test Cases 1 & 2)."""

    def test_dispatches_to_keyword_research_when_async_expand_event(self, keyword_mgmt):
        # Arrange
        mod, research_mock = keyword_mgmt
        event = {
            'async_expand': True,
            'research_id': 'abc',
            'seed_keyword': 'running shoes',
            'industry': 'retail',
            'count': 20,
        }

        # Act
        result = mod.handler(event, None)

        # Assert
        research_mock.assert_called_once_with(event, None)
        assert result == research_mock.return_value, (
            'async_expand event did not return the keyword-research result'
        )
        assert result.get('statusCode') != 404, (
            'async_expand event returned a not-found response (bug)'
        )

    def test_dispatches_to_keyword_research_when_async_competitor_event(self, keyword_mgmt):
        # Arrange
        mod, research_mock = keyword_mgmt
        event = {
            'async_competitor': True,
            'research_id': 'def',
            'url': 'https://example.com',
            'domain': 'example.com',
        }

        # Act
        result = mod.handler(event, None)

        # Assert
        research_mock.assert_called_once_with(event, None)
        assert result == research_mock.return_value, (
            'async_competitor event did not return the keyword-research result'
        )
        assert result.get('statusCode') != 404, (
            'async_competitor event returned a not-found response (bug)'
        )


# --- Preservation test bootstrap (Property 2) ------------------------------
#
# Property 2 requires distinguishing every routing target, so all three
# sub-handlers are stubbed (not just keyword-research). Each stub returns a
# distinct non-404 result so the test can assert exactly which target ran and
# that the not-found fallback (statusCode 404) is only reached when no route
# matches. Seeding the router's HandlerLoader cache means no real sub-handler
# is loaded and no AWS / AI-provider calls occur.

_SUB_HANDLER_FILES = ('keyword-research.py', 'get-keywords.py', 'manage-keywords.py', 'manage-keyword-groups.py')


def _install_all_handler_mocks(mod):
    """Seed the router's cache with a distinct stub for every sub-handler.

    Returns a dict keyed by sub-handler filename so callers can assert which
    routing target was invoked.
    """
    mocks = {}
    for name in _SUB_HANDLER_FILES:
        sub_mock = MagicMock(name=f'{name}_handler')
        sub_mock.return_value = {'statusCode': 200, 'handler': name}
        mod._handlers._cache[name] = sub_mock
        mocks[name] = sub_mock
    return mocks


@pytest.fixture
def keyword_mgmt_all():
    """Fresh keyword-mgmt router with ALL sub-handlers stubbed distinctly."""
    mod = _load_keyword_mgmt()
    mocks = _install_all_handler_mocks(mod)
    return mod, mocks


# --- Non-async event strategies (isBugCondition == false) ------------------

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


# keyword-research: resource/path under /api/keyword-research, no async flags.
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


# not-found: no async flags and an unmatched route, including prefix
# collisions (`/api/keywords-bogus`) that must NOT match a real route.
_UNMATCHED_PATHS = [
    '/api/keywords-bogus',
    '/api/keyword-research-bogus',
    '/api/keyword',
    '/api/other',
    '/health',
    '/api',
    '',
]


@st.composite
def _not_found_events(draw):
    route_path = draw(st.sampled_from(_UNMATCHED_PATHS))
    if route_path:
        event = _with_route(draw, route_path)
    else:
        event = {}
    event['httpMethod'] = draw(_ROUTE_METHODS)
    return event


# Each non-async event is paired with its observed routing target
# (sub-handler filename), or None for the not-found fallback.
_preservation_cases = st.one_of(
    _keyword_research_events().map(lambda e: (e, 'keyword-research.py')),
    _get_keywords_events().map(lambda e: (e, 'get-keywords.py')),
    _manage_keywords_events().map(lambda e: (e, 'manage-keywords.py')),
    _not_found_events().map(lambda e: (e, None)),
)


# --- Property-based tests (Property 2) -------------------------------------


class TestPreservationProperty:
    """
    **Property 2: Non-async events route exactly as before**

    **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

    For any event where the bug condition does NOT hold (neither
    `async_expand` nor `async_competitor` is truthy), `keyword-mgmt.handler`
    dispatches to the same sub-handler and returns the same result as the
    baseline observed on the unfixed code: `/api/keyword-research` ->
    keyword-research, `GET /api/keywords` without `id` -> get-keywords,
    mutations / `id` under `/api/keywords` -> manage-keywords, and unmatched
    routes -> not-found (statusCode 404). These assertions lock in the
    baseline routing that the fix must preserve.
    """

    @settings(max_examples=100)
    @given(case=_preservation_cases)
    def test_routes_to_observed_target_when_event_is_non_async(self, case):
        # Arrange
        event, expected_target = case
        mod = _load_keyword_mgmt()
        mocks = _install_all_handler_mocks(mod)

        # Act
        result = mod.handler(event, None)

        # Assert
        if expected_target is None:
            assert result.get('statusCode') == 404, (
                f"non-async unmatched event {event!r} did not return not-found"
            )
            for sub_mock in mocks.values():
                sub_mock.assert_not_called()
        else:
            mocks[expected_target].assert_called_once_with(event, None)
            assert result == mocks[expected_target].return_value, (
                f"non-async event {event!r} did not return the {expected_target} result"
            )
            for name, sub_mock in mocks.items():
                if name != expected_target:
                    sub_mock.assert_not_called()


# --- Example / unit tests (Property 2 baseline) ----------------------------


class TestPreservationUnit:
    """Explicit baseline cases for each non-async route (design Test Cases 1-4)."""

    def test_routes_to_keyword_research_when_research_path_and_no_async_flags(self, keyword_mgmt_all):
        # Arrange
        mod, mocks = keyword_mgmt_all
        event = {
            'resource': '/api/keyword-research',
            'path': '/api/keyword-research',
            'httpMethod': 'POST',
        }

        # Act
        result = mod.handler(event, None)

        # Assert
        mocks['keyword-research.py'].assert_called_once_with(event, None)
        assert result == mocks['keyword-research.py'].return_value, (
            'keyword-research path did not return the keyword-research result'
        )
        mocks['get-keywords.py'].assert_not_called()
        mocks['manage-keywords.py'].assert_not_called()

    def test_routes_to_get_keywords_when_get_keywords_list_without_id(self, keyword_mgmt_all):
        # Arrange
        mod, mocks = keyword_mgmt_all
        event = {
            'resource': '/api/keywords',
            'path': '/api/keywords',
            'httpMethod': 'GET',
            'pathParameters': None,
        }

        # Act
        result = mod.handler(event, None)

        # Assert
        mocks['get-keywords.py'].assert_called_once_with(event, None)
        assert result == mocks['get-keywords.py'].return_value, (
            'GET /api/keywords did not return the get-keywords result'
        )
        mocks['keyword-research.py'].assert_not_called()
        mocks['manage-keywords.py'].assert_not_called()

    def test_routes_to_manage_keywords_when_mutation_under_keywords(self, keyword_mgmt_all):
        # Arrange
        mod, mocks = keyword_mgmt_all
        event = {
            'resource': '/api/keywords',
            'path': '/api/keywords',
            'httpMethod': 'POST',
        }

        # Act
        result = mod.handler(event, None)

        # Assert
        mocks['manage-keywords.py'].assert_called_once_with(event, None)
        assert result == mocks['manage-keywords.py'].return_value, (
            'POST /api/keywords did not return the manage-keywords result'
        )
        mocks['keyword-research.py'].assert_not_called()
        mocks['get-keywords.py'].assert_not_called()

    def test_routes_to_manage_keywords_when_request_bears_path_parameter_id(self, keyword_mgmt_all):
        # Arrange
        mod, mocks = keyword_mgmt_all
        event = {
            'resource': '/api/keywords/{id}',
            'path': '/api/keywords/abc123',
            'httpMethod': 'GET',
            'pathParameters': {'id': 'abc123'},
        }

        # Act
        result = mod.handler(event, None)

        # Assert
        mocks['manage-keywords.py'].assert_called_once_with(event, None)
        assert result == mocks['manage-keywords.py'].return_value, (
            'GET /api/keywords with id did not return the manage-keywords result'
        )
        mocks['keyword-research.py'].assert_not_called()
        mocks['get-keywords.py'].assert_not_called()

    def test_returns_not_found_when_unmatched_prefix_collision_route(self, keyword_mgmt_all):
        # Arrange
        mod, mocks = keyword_mgmt_all
        event = {
            'resource': '/api/keywords-bogus',
            'path': '/api/keywords-bogus',
            'httpMethod': 'GET',
        }

        # Act
        result = mod.handler(event, None)

        # Assert
        assert result.get('statusCode') == 404, (
            'prefix-collision route /api/keywords-bogus did not return not-found'
        )
        for sub_mock in mocks.values():
            sub_mock.assert_not_called()



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

        mocks['manage-keyword-groups.py'].assert_called_once_with(event, None)
        assert result == mocks['manage-keyword-groups.py'].return_value
        mocks['manage-keywords.py'].assert_not_called()
        mocks['get-keywords.py'].assert_not_called()

    def test_keeps_keyword_routes_away_from_the_groups_handler(self, keyword_mgmt_all):
        mod, mocks = keyword_mgmt_all
        event = {'resource': '/api/keywords', 'path': '/api/keywords', 'httpMethod': 'GET', 'pathParameters': None}

        mod.handler(event, None)

        mocks['manage-keyword-groups.py'].assert_not_called()
        mocks['get-keywords.py'].assert_called_once_with(event, None)
