"""The paid SEO exports replayed against the real Domain Overview and Backlinks handlers: each window is paid once."""

from __future__ import annotations

import json
from dataclasses import replace
from unittest.mock import MagicMock, patch

import pytest

from shared.dataforseo_backlinks import TablePage
from shared.dataforseo_domain import Page
from shared.export_source_routes import ExportSourceError
from shared.export_source_seo_paid import BACKLINKS_PRICING, LABS_PRICING, SEO_BACKLINKS, SEO_DOMAIN
from testing.export_source_fixtures import all_rows, long_deadline
from testing.handler_fixtures import handler_fixture
from testing.seo_domain_fixtures import SNAPSHOT_ENV, ranked_keyword
from testing.seo_fixtures import SEO_DIR, SEO_ENV, seo_event
from testing.seo_paid_export_fixtures import MemoryCache, handler_invoker, through

domains_module = handler_fixture(SEO_DIR, 'seo-domains.py', 'seo_domains_replayed', env={**SEO_ENV, **SNAPSHOT_ENV})
backlinks_module = handler_fixture(SEO_DIR, 'seo-backlinks.py', 'seo_backlinks_replayed', env=SEO_ENV)

TOTAL = 9000
KEYWORDS = {'table': 'keywords', 'target': 'example.com', 'rows': '2500', 'price_usd': repr(LABS_PRICING.price_usd(2500))}
SCREEN_PAGE = {'target': 'example.com', 'page': 1, 'page_size': 50}
BACKLINKS = {'tab': 'backlinks', 'target': 'example.com', 'rows': '2500', 'price_usd': repr(BACKLINKS_PRICING.price_usd(2500))}


def labs_window(_target, _codes, *, limit, offset, **_query):
    """Labs' ranked keywords ``offset`` .. ``offset + limit`` of a list of ``TOTAL``."""
    items = tuple(ranked_keyword(f'kw-{number}') for number in range(offset, min(offset + limit, TOTAL)))
    return Page(items=items, total_count=TOTAL, has_more=offset + limit < TOTAL, cost_usd=0.0)


def backlinks_window(_target, query):
    """DataForSEO's backlinks ``query.offset`` .. ``+ query.limit`` of a list of ``TOTAL``."""
    rows = [{'domain_from': f'site-{number}.example'} for number in range(query.offset, min(query.offset + query.limit, TOTAL))]
    return TablePage(rows=rows, total_count=TOTAL, cost_usd=0.0)


@pytest.fixture
def cache(seo_boundary):
    memory = MemoryCache()
    seo_boundary.get_cached.side_effect = memory.get
    seo_boundary.put_cached.side_effect = memory.put
    return memory


@pytest.fixture
def labs(domains_module):
    fetch = MagicMock(side_effect=labs_window)
    with patch.object(domains_module, 'KEYWORDS_LOOKUP', replace(domains_module.KEYWORDS_LOOKUP, fetch=fetch)):
        yield fetch


@pytest.fixture
def backlinks_api(backlinks_module):
    fetch = MagicMock(side_effect=backlinks_window)
    with patch.object(backlinks_module, 'fetch_table', fetch):
        yield fetch


def first_chunk_cursor(source, params, rows_written):
    """The checkpoint after a first chunk wrote ``rows_written`` rows and stopped for time."""
    reading = source.rows(params, None, long_deadline())
    cursor = None
    for _ in range(rows_written):
        cursor = json.loads(json.dumps(next(reading).cursor))
    reading.close()
    return cursor


@pytest.fixture
def domain_source(domains_module):
    return through(SEO_DOMAIN, handler_invoker(domains_module.handler))


@pytest.fixture
def backlinks_source(backlinks_module):
    return through(SEO_BACKLINKS, handler_invoker(backlinks_module.handler))


class TestDomainOverview:
    def test_exports_the_confirmed_ranked_keywords_through_the_route(self, cache, labs, domain_source):
        rows = all_rows(domain_source, KEYWORDS)

        assert [row.values[0] for row in rows] == [f'kw-{number}' for number in range(2500)]

    def test_a_resumed_chunk_pays_no_window_a_second_time(self, cache, labs, domain_source):
        cursor = first_chunk_cursor(domain_source, KEYWORDS, 1500)

        all_rows(domain_source, KEYWORDS, cursor)

        assert [(call.kwargs['offset'], call.kwargs['limit']) for call in labs.call_args_list] == [(0, 1000), (1000, 1000), (2000, 500)]

    def test_a_resumed_window_no_longer_cached_fails_the_export_without_a_labs_call(self, cache, labs, domain_source):
        cursor = first_chunk_cursor(domain_source, KEYWORDS, 1500)
        cache.clear()
        calls_before = labs.call_count

        with pytest.raises(ExportSourceError, match='answered 409: These rows are no longer cached'):
            all_rows(domain_source, KEYWORDS, cursor)
        assert labs.call_count == calls_before

    def test_the_page_on_screen_is_exported_from_the_cache_for_free(self, cache, labs, domains_module, domain_source):
        domains_module.handler(seo_event('POST', '/api/seo/domains/keywords', body=SCREEN_PAGE), {})
        calls_before = labs.call_count

        rows = all_rows(domain_source, {'table': 'keywords', 'target': 'example.com', 'page': '1', 'page_size': '50'})

        assert (len(rows), labs.call_count) == (50, calls_before)


class TestBacklinks:
    def test_a_resumed_chunk_pays_no_window_a_second_time(self, cache, backlinks_api, backlinks_source):
        cursor = first_chunk_cursor(backlinks_source, BACKLINKS, 1500)

        all_rows(backlinks_source, BACKLINKS, cursor)

        assert [(call.args[1].offset, call.args[1].limit) for call in backlinks_api.call_args_list] == [
            (0, 1000), (1000, 1000), (2000, 500),
        ]

    def test_a_resumed_window_no_longer_cached_fails_the_export_without_a_dataforseo_call(self, cache, backlinks_api, backlinks_source):
        cursor = first_chunk_cursor(backlinks_source, BACKLINKS, 1500)
        cache.clear()
        calls_before = backlinks_api.call_count

        with pytest.raises(ExportSourceError, match='answered 409'):
            all_rows(backlinks_source, BACKLINKS, cursor)
        assert backlinks_api.call_count == calls_before

