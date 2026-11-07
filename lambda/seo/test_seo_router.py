"""``CitationAnalysis-SeoRouter`` (``seo-router.py``): every SEO API route reaches its sub-handler."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

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
