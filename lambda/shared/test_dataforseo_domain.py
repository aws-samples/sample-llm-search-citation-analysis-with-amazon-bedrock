"""DataForSEO Labs domain calls (``shared.dataforseo_domain``): bodies, mapping, paging, no paid retries."""

from __future__ import annotations

import pytest

from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_domain import (
    KeywordFilters,
    PageFilters,
    domain_overview,
    has_more,
    keyword_filters,
    ranked_keyword_from,
    ranked_keywords,
    relevant_pages,
    serp_competitors,
)
from shared.dataforseo_domain_scope import FilterBudgetError, parse_research_target
from shared.dataforseo_locations import UnsupportedMarketError
from testing.assertions import present
from testing.dataforseo_fixtures import install_transport, ok_envelope
from testing.seo_domain_fixtures import overview_item, ranked_item
from testing.seo_fixtures import ADS_CODES, GLOBAL_CODES

ROOT = parse_research_target('example.com')


class TestOverview:
    def test_posts_the_bare_host_with_limit_one(self, monkeypatch):
        transport = install_transport(monkeypatch, ok_envelope([overview_item()], cost=0.01212))

        domain_overview('example.com', GLOBAL_CODES)

        assert transport.calls[0].task == {'target': 'example.com', 'location_code': 2840, 'language_code': 'en', 'limit': 1}

    def test_rounds_the_traffic_and_reads_the_keyword_count(self, monkeypatch):
        install_transport(monkeypatch, ok_envelope([overview_item()], cost=0.01212))

        result = domain_overview('example.com', GLOBAL_CODES)

        assert (result.organic_keywords, result.estimated_traffic, result.traffic_cost) == (1520, 8451, 12034.57)

    def test_groups_the_position_buckets(self, monkeypatch):
        install_transport(monkeypatch, ok_envelope([overview_item()]))

        assert domain_overview('example.com', GLOBAL_CODES).position_buckets == (
            ('1', 10), ('2-3', 20), ('4-10', 70), ('11-20', 100), ('21-50', 120), ('51-100', 3),
        )

    def test_has_no_data_without_an_item(self, monkeypatch):
        install_transport(monkeypatch, ok_envelope([]))

        assert domain_overview('example.com', GLOBAL_CODES).has_data is False

    def test_refuses_a_google_ads_only_market_before_any_call(self, monkeypatch):
        transport = install_transport(monkeypatch)

        with pytest.raises(UnsupportedMarketError, match='Labs'):
            domain_overview('example.com', ADS_CODES)
        assert transport.calls == []

    def test_never_resends_a_billed_call_after_a_server_error(self, monkeypatch):
        transport = install_transport(monkeypatch, (500, 'oops'), (500, 'oops'), (500, 'oops'))

        with pytest.raises(DataForSeoError):
            domain_overview('example.com', GLOBAL_CODES)
        assert len(transport.calls) == 1


class TestRankedKeywordMapping:
    def test_reads_rank_absolute_as_position_and_rank_group_as_organic_position(self):
        row = present(ranked_keyword_from(ranked_item(rank_absolute=4, rank_group=3)))

        assert (row.position, row.organic_position) == (4, 3)

    def test_derives_the_relative_url_from_the_url(self):
        assert present(ranked_keyword_from(ranked_item())).relative_url == '/flights?x=1'

    def test_falls_back_to_rank_absolute_without_rank_group(self):
        assert present(ranked_keyword_from(ranked_item(rank_absolute=7, rank_group=None))).organic_position == 7

    @pytest.mark.parametrize(('main_intent', 'intent'), [
        ('informational', 'informational'),
        ('commercial', 'commercial'),
        ('Transactional', 'transactional'),
        ('navigational', 'navigational'),
        ('local', 'unknown'),
        ('', 'unknown'),
        (None, 'unknown'),
    ])
    def test_reads_main_intent_as_one_of_the_five_app_intents(self, main_intent, intent):
        item = ranked_item(search_intent_info={'main_intent': main_intent})

        assert present(ranked_keyword_from(item)).intent == intent

    def test_reads_intent_as_unknown_when_search_intent_info_is_missing(self):
        item = ranked_item(search_intent_info={})

        assert present(ranked_keyword_from(item)).intent == 'unknown'

    def test_reads_intent_as_unknown_when_search_intent_info_is_not_an_object(self):
        item = ranked_item(search_intent_info='commercial')

        assert present(ranked_keyword_from(item)).intent == 'unknown'

    def test_drops_an_item_without_a_keyword(self):
        assert ranked_keyword_from({'keyword_data': {}, 'ranked_serp_element': {}}) is None


class TestRankedKeywords:
    def test_sends_paging_sort_and_filters(self, monkeypatch):
        transport = install_transport(monkeypatch, ok_envelope([ranked_item()], total_count=1))
        target = parse_research_target('example.com', 'domain')

        ranked_keywords(target, GLOBAL_CODES, limit=50, offset=100, sort='volume', order='asc', filters=KeywordFilters(min_volume=10))

        task = transport.calls[0].task
        assert (task['offset'], task['order_by'], len(task['filters'])) == (100, ['keyword_data.keyword_info.search_volume,asc'], 3)

    def test_omits_filters_for_an_unfiltered_subdomains_request(self, monkeypatch):
        transport = install_transport(monkeypatch, ok_envelope([], total_count=0))

        ranked_keywords(ROOT, GLOBAL_CODES, limit=50)

        assert 'filters' not in transport.calls[0].task

    def test_counts_more_pages_from_the_raw_rows_when_rows_are_dropped(self, monkeypatch):
        install_transport(monkeypatch, ok_envelope([ranked_item(), {'keyword_data': {}}], total_count=None))

        page = ranked_keywords(ROOT, GLOBAL_CODES, limit=2)

        assert (len(page.items), page.has_more) == (1, True)

    def test_refuses_too_many_filters_before_any_call(self, monkeypatch):
        transport = install_transport(monkeypatch)

        with pytest.raises(FilterBudgetError):
            ranked_keywords(ROOT, GLOBAL_CODES, limit=50, filters=KeywordFilters(include='a,b,c,d,e,f,g,h,i'))
        assert transport.calls == []


class TestKeywordFilters:
    def test_adds_one_condition_per_term_and_range_bound(self):
        expression = keyword_filters(KeywordFilters(include='shoes', exclude='free', max_rank=10), None, ROOT)

        assert expression == [
            ['keyword_data.keyword', 'ilike', '%shoes%'], 'and', ['keyword_data.keyword', 'not_ilike', '%free%'], 'and',
            ['ranked_serp_element.serp_item.rank_absolute', '<=', 10],
        ]

    def test_searches_keyword_or_url_as_one_group(self):
        assert keyword_filters(KeywordFilters(), ' 50% ', ROOT) == [[
            ['keyword_data.keyword', 'ilike', '%50\\%%'], 'or', ['ranked_serp_element.serp_item.url', 'ilike', '%50\\%%'],
        ]]


class TestPagesAndCompetitors:
    def test_maps_a_page_with_its_relative_path(self, monkeypatch):
        item = {'page_address': 'https://example.com/blog/a', 'metrics': {'organic': {'etv': 12.5, 'count': 4}}}
        install_transport(monkeypatch, ok_envelope([item], total_count=1))

        page = relevant_pages(ROOT, GLOBAL_CODES, limit=50, filters=PageFilters(min_keywords=2))

        assert (page.items[0].relative_url, page.items[0].etv, page.items[0].keywords, page.has_more) == ('/blog/a', 12.5, 4, False)

    def test_asks_for_organic_and_local_pack_competitors(self, monkeypatch):
        transport = install_transport(monkeypatch, ok_envelope([{'domain': 'acme.example.org', 'visibility': 0.4}]))

        rows, _cost = serp_competitors(['cheap flights'], GLOBAL_CODES, limit=50)

        assert (transport.calls[0].task['item_types'], rows[0].domain) == (['organic', 'local_pack'], 'acme.example.org')


@pytest.mark.parametrize(('offset', 'fetched', 'total', 'size', 'expected'), [
    (0, 50, 120, 50, True), (100, 20, 120, 50, False), (0, 50, None, 50, True), (0, 49, None, 50, False),
])
def test_has_more_follows_the_total_or_a_full_page(offset, fetched, total, size, expected):
    assert has_more(offset, fetched, total, size) is expected
