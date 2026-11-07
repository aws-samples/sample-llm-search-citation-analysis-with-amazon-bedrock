"""``POST /api/seo/serp`` (``seo-keywords.py``): depth-aware cache, AI Overview flag, validation."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from shared.dataforseo_serp import SerpSnapshot
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.seo_fixtures import SEO_DIR, SEO_ENV, organic_item, seo_event

serp_module = handler_fixture(SEO_DIR, 'seo-keywords.py', 'seo_serp_under_test', env=SEO_ENV)

ITEM = organic_item(1, 'https://example.com/flights', 'example.com')
ITEM_JSON = {'position': 1, 'rank_absolute': 1, 'url': 'https://example.com/flights', 'domain': 'example.com',
             'title': 'Result 1', 'description': ''}
SNAPSHOT = SerpSnapshot(items=(ITEM,), item_types=('ai_overview', 'organic'), check_url='https://www.google.com/search?q=x', cost_usd=0.0035)
EMPTY = SerpSnapshot(items=(), item_types=(), check_url=None, cost_usd=0.0035)
STORED_AT = '2026-10-01T10:00:00Z'


class Serp:
    """One SERP request, with DataForSEO stubbed and the cache from ``seo_boundary``."""

    def __init__(self, module, boundary, body, *, stored_depth=None, stored_items=(ITEM_JSON,), snapshot=SNAPSHOT,
                 checked_depth=None):
        self.organic_serp = MagicMock(return_value=snapshot)
        self.put_cached = boundary.put_cached
        if stored_depth is not None:
            boundary.get_cached.return_value = {
                'depth': stored_depth, 'items': list(stored_items), 'item_types': ['organic'], 'check_url': None,
                'fetched_at': STORED_AT, **({'checked_depth': checked_depth} if checked_depth is not None else {}),
            }
        with patch.object(module, 'organic_serp', self.organic_serp):
            self.status, self.body = parse_response(module.handler(seo_event('POST', '/api/seo/serp', body=body), {}))


@pytest.fixture
def serp(serp_module, seo_boundary):
    """``serp(body, **stubs)``: one SERP request."""
    return lambda body, **stubs: Serp(serp_module, seo_boundary, body, **stubs)


@pytest.fixture
def empty_deeper_crawl(serp):
    """A depth-50 request whose crawl comes back empty while a non-empty depth-20 snapshot is cached."""
    return serp({'keyword': 'x', 'depth': 50}, stored_depth=20, snapshot=EMPTY)


class TestFreshSerp:
    def test_answers_the_organic_items_of_a_fresh_crawl(self, serp):
        call = serp({'keyword': 'Cheap Flights'})

        assert (call.status, call.body['items'], call.body['cached'], call.body['keyword']) == (200, [ITEM_JSON], False, 'cheap flights')

    def test_flags_an_ai_overview_on_the_results_page(self, serp):
        assert serp({'keyword': 'x'}).body['has_ai_overview'] is True

    def test_crawls_at_the_requested_depth(self, serp):
        call = serp({'keyword': 'x', 'depth': 50})

        assert (call.organic_serp.call_args.args[2], call.body['depth']) == (50, 50)

    def test_stores_the_snapshot_for_12_hours_keyed_without_its_depth(self, serp):
        stored = serp({'keyword': 'x', 'depth': 50}).put_cached.call_args

        assert (stored.args[:3], stored.args[3]['depth'], stored.args[4]) == (
            ('serp', 1, {'keyword': 'x', 'location_code': 2840, 'language_code': 'en'}), 50, 43_200,
        )


class TestCachedSerp:
    def test_serves_a_deeper_cached_snapshot_without_a_crawl(self, serp):
        call = serp({'keyword': 'x', 'depth': 20}, stored_depth=50)

        assert (call.body['cached'], call.body['depth'], call.body['fetched_at'], call.organic_serp.call_count) == (True, 50, STORED_AT, 0)

    def test_crawls_again_when_the_cached_snapshot_is_shallower(self, serp):
        call = serp({'keyword': 'x', 'depth': 50}, stored_depth=20)

        assert (call.body['cached'], call.organic_serp.call_count) == (False, 1)

    def test_serves_cached_results_when_a_deeper_crawl_is_empty(self, empty_deeper_crawl):
        body = empty_deeper_crawl.body

        assert (body['items'], body['cached'], body['depth'], body['fetched_at']) == ([ITEM_JSON], True, 20, STORED_AT)

    def test_marks_cached_results_checked_at_the_deeper_depth_when_the_crawl_is_empty(self, empty_deeper_crawl):
        stored = empty_deeper_crawl.put_cached.call_args.args[3]

        assert (stored['items'], stored['depth'], stored['checked_depth']) == ([ITEM_JSON], 20, 50)

    def test_serves_a_snapshot_checked_at_the_requested_depth_without_a_crawl(self, serp):
        call = serp({'keyword': 'x', 'depth': 50}, stored_depth=20, checked_depth=50)

        assert (call.body['cached'], call.body['depth'], call.organic_serp.call_count) == (True, 20, 0)

    def test_replaces_an_empty_cached_snapshot_with_an_empty_crawl(self, serp):
        call = serp({'keyword': 'x', 'depth': 50}, stored_depth=20, stored_items=(), snapshot=EMPTY)

        assert call.put_cached.call_count == 1


@pytest.mark.parametrize(('body', 'field'), [
    ({}, 'keyword'),
    ({'keyword': 'x' * 201}, 'keyword'),
    ({'keyword': 'x', 'depth': 100}, 'depth'),
])
def test_serp_refuses_a_bad_field_without_crawling(serp, body, field):
    call = serp(body)

    assert [call.status, call.body['code'], call.body['field'], call.organic_serp.called] == [400, 'VALIDATION_ERROR', field, False]
