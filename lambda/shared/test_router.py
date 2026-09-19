"""
Unit tests for shared.router.

Covers `HandlerLoader` (the lazy/cached loading helper consolidated API
routers use to dispatch to hyphenated sub-handler files), the two route
matchers, and `dispatch_route` (the shared router body).
"""

import importlib
import logging
import os
import sys
import textwrap

import pytest

# The shared package __init__ re-exports api_response as a function, which
# can shadow the submodule — import the router module object directly.
router_mod = importlib.import_module('shared.router')
HandlerLoader = router_mod.HandlerLoader


@pytest.fixture
def sub_handler_dir(tmp_path):
    """
    Create a scratch directory with a few hyphenated sub-handlers.

    Returns a path to a dummy "router" .py file inside that directory so the
    caller can pass it as `router_file` to HandlerLoader.
    """
    (tmp_path / 'good-handler.py').write_text(
        textwrap.dedent("""
            CALL_COUNT = 0
            def handler(event, context):
                global CALL_COUNT
                CALL_COUNT += 1
                return {'statusCode': 200, 'called': CALL_COUNT}
        """)
    )
    (tmp_path / 'other-handler.py').write_text(
        'def handler(event, context):\n    return {"statusCode": 201}\n'
    )
    (tmp_path / 'no-handler-attr.py').write_text(
        'not_a_handler = lambda e, c: None\n'
    )
    router_file = tmp_path / 'fake-router.py'
    router_file.write_text('# placeholder router\n')
    return router_file


def test_returns_handler_callable_for_existing_file(sub_handler_dir):
    loader = HandlerLoader(str(sub_handler_dir))

    fn = loader.get('good-handler.py')

    assert callable(fn)
    assert fn({}, None) == {'statusCode': 200, 'called': 1}


def test_caches_loaded_handler_across_calls(sub_handler_dir):
    """
    REGRESSION: the previous inline _handler_cache implementation cached per
    router. The HandlerLoader must preserve that behavior so sub-handlers are
    imported at most once per Lambda container.
    """
    loader = HandlerLoader(str(sub_handler_dir))

    first = loader.get('good-handler.py')
    second = loader.get('good-handler.py')

    assert first is second


def test_resolves_sub_handlers_relative_to_router_file(sub_handler_dir):
    """
    HandlerLoader must look for sub-handlers next to the router file, even
    when called from a different cwd.
    """
    original_cwd = os.getcwd()
    try:
        os.chdir(os.path.dirname(os.path.dirname(str(sub_handler_dir))))
        loader = HandlerLoader(str(sub_handler_dir))
        fn = loader.get('other-handler.py')

        assert fn({}, None) == {'statusCode': 201}
    finally:
        os.chdir(original_cwd)


def test_raises_import_error_when_file_missing(sub_handler_dir):
    loader = HandlerLoader(str(sub_handler_dir))

    with pytest.raises((ImportError, FileNotFoundError)):
        loader.get('nonexistent-handler.py')


def test_raises_attribute_error_when_handler_symbol_missing(sub_handler_dir):
    loader = HandlerLoader(str(sub_handler_dir))

    with pytest.raises(AttributeError, match="no 'handler' attribute"):
        loader.get('no-handler-attr.py')


def test_each_loader_has_independent_cache(sub_handler_dir, tmp_path):
    """
    Two router instances pointing at different directories must not share
    cache entries — loading the same filename in one must not satisfy a call
    in the other.
    """
    other_dir = tmp_path / 'other'
    other_dir.mkdir()
    (other_dir / 'good-handler.py').write_text(
        'def handler(event, context):\n    return {"statusCode": 418}\n'
    )
    other_router = other_dir / 'fake-router.py'
    other_router.write_text('# placeholder\n')

    loader_a = HandlerLoader(str(sub_handler_dir))
    loader_b = HandlerLoader(str(other_router))

    fn_a = loader_a.get('good-handler.py')
    fn_b = loader_b.get('good-handler.py')

    assert fn_a({}, None)['statusCode'] == 200
    assert fn_b({}, None)['statusCode'] == 418


def test_translates_hyphenated_filename_to_valid_module_name(sub_handler_dir):
    """
    Hyphenated filenames aren't valid Python module names. The loader should
    translate them (hyphens -> underscores, drop .py) so they register cleanly
    in sys.modules.
    """
    loader = HandlerLoader(str(sub_handler_dir))
    fn = loader.get('good-handler.py')
    fn({}, None)

    assert 'good_handler' in sys.modules
    assert sys.modules['good_handler'].CALL_COUNT >= 1



class TestPathMatchesRoute:
    """Regression tests for `path_matches_route` — segment-exact routing
    that replaced the `startswith` substring match in every consolidated
    router (audit item 26).
    """

    def test_exact_route_matches(self) -> None:
        assert router_mod.path_matches_route('/api/stats', '/api/stats', '/api/stats') is True

    def test_route_with_segment_child_matches(self) -> None:
        """`/api/stats/summary` is a child segment of `/api/stats`."""
        assert router_mod.path_matches_route('/api/stats', '/api/stats', '/api/stats/summary') is True

    def test_route_template_with_path_parameter_matches(self) -> None:
        """API Gateway resource templates carry path params — the concrete
        path should still match the template's route prefix."""
        assert router_mod.path_matches_route(
            '/api/executions', '/api/executions/{id}', '/api/executions/abc123'
        ) is True

    def test_does_not_match_sibling_route_with_shared_prefix(self) -> None:
        """REGRESSION GUARD: the old `startswith` implementation matched
        `/api/stats-bogus` for the `/api/stats` route. The fix requires a
        `/` segment boundary, so cousin routes no longer collide."""
        assert router_mod.path_matches_route('/api/stats', '/api/stats-bogus', '/api/stats-bogus') is False

    def test_does_not_match_prefix_without_slash_boundary(self) -> None:
        """`/api/keywordsurprise` is not a child of `/api/keywords`."""
        assert router_mod.path_matches_route('/api/keywords', '/api/keywordsurprise', '/api/keywordsurprise') is False

    def test_matches_if_either_resource_or_path_matches(self) -> None:
        """Routers check both the template (resource) and the concrete path
        because API Gateway returns them separately."""
        assert router_mod.path_matches_route('/api/stats', '/api/stats', '/other/path') is True
        assert router_mod.path_matches_route('/api/stats', '/other/resource', '/api/stats') is True

    def test_returns_false_when_both_are_empty(self) -> None:
        assert router_mod.path_matches_route('/api/stats', '', '') is False

    def test_returns_false_when_both_are_none(self) -> None:
        assert router_mod.path_matches_route('/api/stats', None, None) is False  # type: ignore[arg-type]



class TestPathContainsSegment:
    """Tests for `path_contains_segment` — the core primitive both
    router matchers are built on (see `path_matches_route` and the
    tuple-key route matcher in decorators).
    """

    def test_matches_exact_segment(self) -> None:
        assert router_mod.path_contains_segment('/ideas', '/ideas') is True

    def test_matches_segment_at_end_of_path(self) -> None:
        assert router_mod.path_contains_segment('/ideas', '/api/content-studio/ideas') is True

    def test_matches_interior_segment(self) -> None:
        assert router_mod.path_contains_segment('/ideas', '/api/content-studio/ideas/123') is True

    def test_does_not_match_hyphenated_cousin(self) -> None:
        """REGRESSION: `/ideas` vs `/my-ideas-list` — the exact bug audit
        item 26 called out. `endswith('/ideas')` returns False because
        the leading `/` forces a segment boundary."""
        assert router_mod.path_contains_segment('/ideas', '/api/content-studio/my-ideas-list') is False

    def test_does_not_match_suffix_attached_to_segment(self) -> None:
        """`/ideas` is not a valid segment inside `/ideas-archive`."""
        assert router_mod.path_contains_segment('/ideas', '/api/x/ideas-archive') is False

    def test_returns_false_for_empty_request_path(self) -> None:
        assert router_mod.path_contains_segment('/ideas', '') is False



class TestDispatchRoute:
    """Tests for `dispatch_route` — the router body shared by the
    consolidated API Lambdas (citations-content, config-mgmt,
    execution-mgmt, stats-insights).
    """

    @pytest.fixture
    def loader(self, tmp_path):
        """A `HandlerLoader` over two sub-handlers that echo which one ran."""
        for name in ('status-handler', 'generic-handler'):
            (tmp_path / f'{name}.py').write_text(
                f'def handler(event, context):\n'
                f'    return {{"handled_by": "{name}", "event": event, "context": context}}\n'
            )
        return HandlerLoader(str(tmp_path / 'fake-router.py'))

    @pytest.fixture
    def route_map(self):
        # Specific-before-generic, as the stats-insights router relies on.
        return {
            '/api/things/{id}/status': 'status-handler.py',
            '/api/things': 'generic-handler.py',
        }

    @pytest.fixture(autouse=True)
    def _dev_cors(self, monkeypatch):
        """Make the 404 path deterministic regardless of the ambient CORS env."""
        api_response = importlib.import_module('shared.api_response')
        monkeypatch.delenv('CORS_ORIGIN_PARAM', raising=False)
        monkeypatch.setenv('ALLOW_DEV_CORS', 'true')
        monkeypatch.setattr(api_response, '_cors_origin_cache', None)

    def test_dispatches_to_the_first_route_whose_prefix_matches(self, loader, route_map):
        event = {'resource': '/api/things/{id}/status', 'path': '/api/things/42/status'}

        result = router_mod.dispatch_route(event, None, route_map, loader, logging.getLogger('t'))

        assert result['handled_by'] == 'status-handler'

    def test_falls_through_to_the_generic_route_for_a_plain_child_path(self, loader, route_map):
        event = {'resource': '/api/things/{id}', 'path': '/api/things/42'}

        result = router_mod.dispatch_route(event, None, route_map, loader, logging.getLogger('t'))

        assert result['handled_by'] == 'generic-handler'

    def test_passes_event_and_context_through_to_the_sub_handler(self, loader, route_map):
        event = {'resource': '/api/things', 'path': '/api/things', 'httpMethod': 'GET'}
        context = object()

        result = router_mod.dispatch_route(event, context, route_map, loader, logging.getLogger('t'))

        assert result['event'] is event
        assert result['context'] is context

    def test_matches_on_the_concrete_path_when_the_resource_is_missing(self, loader, route_map):
        event = {'path': '/api/things/7'}

        result = router_mod.dispatch_route(event, None, route_map, loader, logging.getLogger('t'))

        assert result['handled_by'] == 'generic-handler'

    def test_returns_404_through_not_found_response_when_no_route_matches(self, loader, route_map):
        event = {'resource': '/api/other', 'path': '/api/other', 'headers': {}}

        result = router_mod.dispatch_route(event, None, route_map, loader, logging.getLogger('t'))

        assert result['statusCode'] == 404
        assert 'Route not found' in result['body']
        assert result['headers']['Access-Control-Allow-Origin'] == '*'

    def test_does_not_match_a_sibling_route_sharing_a_prefix(self, loader, route_map):
        """REGRESSION GUARD: `/api/things-archive` is not under `/api/things`."""
        event = {'resource': '/api/things-archive', 'path': '/api/things-archive', 'headers': {}}

        result = router_mod.dispatch_route(event, None, route_map, loader, logging.getLogger('t'))

        assert result['statusCode'] == 404
