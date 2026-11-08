"""``CitationAnalysis-SeoRouter`` (``seo-router.py``): every SEO API route reaches its sub-handler."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from shared import seo_spend_limit
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.seo_fixtures import SEO_DIR, SEO_ENV, seo_event

router = handler_fixture(SEO_DIR, 'seo-router.py', 'seo_router_under_test', env=SEO_ENV)


@pytest.mark.parametrize(('method', 'path', 'filename'), [
    ('POST', '/api/seo/keywords/research', 'seo-keywords.py'),
    ('POST', '/api/seo/keywords/metrics', 'seo-keyword-metrics.py'),
    ('POST', '/api/seo/keywords/metrics/lookup', 'seo-keyword-metrics.py'),
    ('POST', '/api/seo/serp', 'seo-keywords.py'),
    ('GET', '/api/seo/account', 'seo-account.py'),
    ('GET', '/api/seo/seo-geo', 'seo-geo.py'),
])
def test_dispatches_each_route_to_its_sub_handler(router, method, path, filename):
    loader = MagicMock()
    with patch('shared.consolidated_router.HandlerLoader', return_value=loader):
        handler = router.route_map_handler(router.__file__, router.ROUTE_MAP, router.__name__)
    handler(seo_event(method, path), {})

    assert loader.get.call_args.args == (filename,)


def test_answers_404_for_a_path_outside_the_seo_api(router):
    status, _body = parse_response(router.handler(seo_event('GET', '/api/seo/unknown'), {}))

    assert status == 404


def test_every_routed_file_exists(router):
    assert [name for name in router.ROUTE_MAP.values() if not os.path.isfile(os.path.join(SEO_DIR, name))] == []


class TestDailyLimit:
    """The paid one-off routes count against the caller's UTC day before they are dispatched (tenet 4)."""

    def call(self, router, method, path, allowed):
        take, dispatch = MagicMock(return_value=allowed), MagicMock(return_value={'statusCode': 200, 'body': '{}'})
        with patch.object(seo_spend_limit, 'take', take):
            status, body = parse_response(seo_spend_limit.limited(dispatch)(seo_event(method, path), {}))
        return status, body, take, dispatch

    def test_puts_the_whole_router_behind_the_limit(self, router):
        assert router.handler.__qualname__.startswith('limited.')

    def test_counts_a_paid_lookup_and_dispatches_it(self, router):
        status, _body, take, dispatch = self.call(router, 'POST', '/api/seo/keywords/research', True)

        assert (status, take.call_count, dispatch.call_count) == (200, 1, 1)

    def test_answers_429_and_makes_no_call_past_the_limit(self, router):
        status, body, _take, dispatch = self.call(router, 'POST', '/api/seo/serp', False)

        assert (status, body['code'], dispatch.call_count) == (429, 'DAILY_LIMIT', 0)

    @pytest.mark.parametrize(('method', 'path'), [('GET', '/api/seo/seo-geo'), ('POST', '/api/seo/keywords/metrics/lookup')])
    def test_does_not_count_a_free_route(self, router, method, path):
        assert self.call(router, method, path, False)[2].call_count == 0
