"""The paid SEO export sources (``shared.export_source_seo_paid``): confirmation, windows, resume without a second payment."""

from __future__ import annotations

import json

import pytest

from shared.export_contract import ExportMark, ExportRow, RowsEnd
from shared.export_source_routes import ExportSourceError
from shared.export_source_seo_paid import (
    BACKLINKS_PRICING,
    LABS_PRICING,
    SEO_BACKLINKS,
    SEO_DOMAIN,
    ExportPricing,
)
from testing.export_source_fixtures import USER, all_rows, drained, long_deadline
from testing.seo_paid_export_fixtures import FakeSeoTable, through

KEYWORDS = {'table': 'keywords', 'target': 'example.com', 'sort': 'traffic', 'order': 'desc'}


def confirmed(rows: int, pricing: ExportPricing = LABS_PRICING, /, **params: str) -> dict[str, str]:
    """``params`` with ``rows`` rows confirmed at their price, as the dashboard queues them."""
    return {**params, 'rows': str(rows), 'price_usd': repr(pricing.price_usd(rows))}


DOMAIN_2500 = confirmed(2500, **KEYWORDS)


class TestPricing:
    def test_prices_a_window_per_1000_rows_plus_every_row(self):
        assert LABS_PRICING.price_usd(2500) == pytest.approx(3 * 0.012 + 2500 * 0.00012)

    def test_prices_backlinks_rows_at_the_backlinks_prices(self):
        assert BACKLINKS_PRICING.price_usd(1000) == pytest.approx(0.024 + 1000 * 0.000036)


class TestConfirmation:
    def test_accepts_rows_confirmed_at_their_price(self):
        assert SEO_DOMAIN.validate(DOMAIN_2500, USER) is None

    def test_accepts_a_price_with_the_dashboards_float_noise(self):
        params = {**DOMAIN_2500, 'price_usd': repr(LABS_PRICING.price_usd(2500) + 1e-12)}

        assert SEO_DOMAIN.validate(params, USER) is None

    def test_refuses_a_paid_export_without_a_confirmed_row_count(self):
        params = {**KEYWORDS, 'price_usd': '0.336'}

        assert SEO_DOMAIN.validate(params, USER) == 'rows must be the confirmed row count, a whole number from 1 to 10,000'

    @pytest.mark.parametrize('rows', ['0', '10001', '-5', '2.5', 'all'])
    def test_refuses_a_row_count_outside_1_to_10000(self, rows):
        params = {**DOMAIN_2500, 'rows': rows}

        assert SEO_DOMAIN.validate(params, USER) == 'rows must be the confirmed row count, a whole number from 1 to 10,000'

    def test_refuses_a_paid_export_without_a_confirmed_price(self):
        params = {**KEYWORDS, 'rows': '2500'}

        assert SEO_DOMAIN.validate(params, USER) == 'price_usd must be the price confirmed for these rows'

    @pytest.mark.parametrize('price', ['0.30', '0', 'nan', 'inf'])
    def test_refuses_a_price_these_rows_do_not_cost(self, price):
        params = {**DOMAIN_2500, 'price_usd': price}

        assert SEO_DOMAIN.validate(params, USER) == 'The price of this export is not the one confirmed. Open the export again to see its price.'

    def test_refuses_a_labs_price_for_backlinks_rows(self):
        params = confirmed(1000, LABS_PRICING, tab='backlinks', target='example.com')

        assert SEO_BACKLINKS.validate(params, USER) == 'The price of this export is not the one confirmed. Open the export again to see its price.'

    def test_refuses_a_table_the_view_does_not_have(self):
        params = {**DOMAIN_2500, 'table': 'competitors'}

        assert SEO_DOMAIN.validate(params, USER) == 'table must be one of: keywords, pages'

    def test_refuses_filters_that_are_not_json(self):
        params = {**DOMAIN_2500, 'filters': 'min_volume=10'}

        assert SEO_DOMAIN.validate(params, USER) == 'filters must be JSON'


class TestScreenPage:
    def test_accepts_the_page_on_screen_without_a_price(self):
        params = {**KEYWORDS, 'page': '2', 'page_size': '50'}

        assert SEO_DOMAIN.validate(params, USER) is None

    def test_refuses_a_page_export_that_also_carries_a_row_count(self):
        params = {**DOMAIN_2500, 'page': '2', 'page_size': '50'}

        assert SEO_DOMAIN.validate(params, USER) == 'Unknown parameter for the seo-domain export: price_usd, rows'

    def test_asks_the_page_on_screen_from_the_cache_only(self):
        route = FakeSeoTable(total=500, cached={(50, 50)})

        all_rows(through(SEO_DOMAIN, route), {**KEYWORDS, 'page': '2', 'page_size': '50'})

        assert route.bodies == [{**{k: v for k, v in KEYWORDS.items() if k != 'table'}, 'page': 2, 'page_size': 50, 'cached_only': True}]

    def test_exports_the_rows_of_the_page_on_screen(self):
        route = FakeSeoTable(total=500, cached={(50, 50)})

        rows = all_rows(through(SEO_DOMAIN, route), {**KEYWORDS, 'page': '2', 'page_size': '50'})

        assert [row.values[0] for row in rows] == [f'kw-{number}' for number in range(50, 100)]

    def test_fails_without_paying_when_the_page_on_screen_is_no_longer_cached(self):
        route = FakeSeoTable(total=500)

        with pytest.raises(ExportSourceError, match='answered 409: These rows are no longer cached'):
            all_rows(through(SEO_DOMAIN, route), {**KEYWORDS, 'page': '2', 'page_size': '50'})
        assert route.paid == []


class TestWindows:
    def test_asks_the_confirmed_rows_in_windows_of_1000_and_the_rest(self):
        route = FakeSeoTable(total=9000)

        all_rows(through(SEO_DOMAIN, route), DOMAIN_2500)

        assert [(body['offset'], body['limit']) for body in route.bodies] == [(0, 1000), (1000, 1000), (2000, 500)]

    def test_exports_exactly_the_confirmed_rows_in_the_lists_order(self):
        route = FakeSeoTable(total=9000)

        rows = all_rows(through(SEO_DOMAIN, route), DOMAIN_2500)

        assert [row.values[0] for row in rows] == [f'kw-{number}' for number in range(2500)]

    def test_stops_when_the_route_says_no_row_follows(self):
        route = FakeSeoTable(total=1000)

        all_rows(through(SEO_DOMAIN, route), confirmed(5000, **KEYWORDS))

        assert route.paid == [(0, 1000)]

    def test_posts_the_views_sort_search_and_decoded_filters_to_the_keywords_route(self):
        route = FakeSeoTable(total=10)
        params = confirmed(10, **KEYWORDS, search='shoes', market_id='ch-de', filters=json.dumps({'min_volume': 10}))

        all_rows(through(SEO_DOMAIN, route), params)

        assert (route.requests[0].method, route.requests[0].path, route.bodies[0]) == ('POST', '/api/seo/domains/keywords', {
            'target': 'example.com', 'sort': 'traffic', 'order': 'desc', 'search': 'shoes', 'market_id': 'ch-de',
            'filters': {'min_volume': 10}, 'offset': 0, 'limit': 10,
        })

    def test_posts_the_backlinks_tab_with_its_spam_rule_and_link_mode(self):
        route = FakeSeoTable(total=10, items_key='rows')
        params = confirmed(10, BACKLINKS_PRICING, tab='backlinks', target='example.com', sort_field='rank',
                           sort_order='asc', include_spam='true', mode='as_is', filters='{}')

        all_rows(through(SEO_BACKLINKS, route), params)

        assert (route.requests[0].path, route.bodies[0]) == ('/api/seo/backlinks/rows', {
            'target': 'example.com', 'sort_field': 'rank', 'sort_order': 'asc', 'include_spam': True, 'mode': 'as_is',
            'filters': {}, 'offset': 0, 'limit': 10,
        })

    def test_never_forwards_the_confirmation_to_the_route(self):
        route = FakeSeoTable(total=10)

        all_rows(through(SEO_DOMAIN, route), confirmed(10, **KEYWORDS))

        assert {'rows', 'price_usd', 'table'} & set(route.bodies[0]) == set()


def _first_chunk(source, params, rows_written):
    """The cursor after ``rows_written`` rows of a first chunk that then stopped for time (the worker's checkpoint)."""
    reading = source.rows(params, None, long_deadline())
    cursor = None
    for _ in range(rows_written):
        item = next(reading)
        assert isinstance(item, ExportRow | ExportMark)
        cursor = json.loads(json.dumps(item.cursor))
    reading.close()
    return cursor


class TestResume:
    def test_asks_the_window_it_resumes_inside_from_the_cache_only(self):
        route = FakeSeoTable(total=9000)
        source = through(SEO_DOMAIN, route)
        cursor = _first_chunk(source, DOMAIN_2500, 1500)

        all_rows(source, DOMAIN_2500, cursor)

        assert [(body['offset'], body.get('cached_only')) for body in route.bodies[2:]] == [(1000, True), (2000, None)]

    def test_pays_each_window_once_across_a_resume(self):
        route = FakeSeoTable(total=9000)
        source = through(SEO_DOMAIN, route)
        cursor = _first_chunk(source, DOMAIN_2500, 1500)

        all_rows(source, DOMAIN_2500, cursor)

        assert route.paid == [(0, 1000), (1000, 1000), (2000, 500)]

    def test_resumes_with_the_row_after_the_last_one_written(self):
        route = FakeSeoTable(total=9000)
        source = through(SEO_DOMAIN, route)
        cursor = _first_chunk(source, DOMAIN_2500, 1500)

        rows = all_rows(source, DOMAIN_2500, cursor)

        assert (rows[0].values[0], len(rows)) == ('kw-1500', 1000)

    def test_fails_instead_of_paying_twice_when_the_resumed_window_is_no_longer_cached(self):
        route = FakeSeoTable(total=9000)
        source = through(SEO_DOMAIN, route)
        cursor = _first_chunk(source, DOMAIN_2500, 1500)
        route.cached.clear()

        with pytest.raises(ExportSourceError, match='answered 409'):
            all_rows(source, DOMAIN_2500, cursor)
        assert route.paid == [(0, 1000), (1000, 1000)]

    def test_finishes_after_the_last_confirmed_row(self):
        route = FakeSeoTable(total=9000)
        source = through(SEO_DOMAIN, route)

        _rows, end = drained(source.rows(DOMAIN_2500, None, long_deadline()))

        assert end is RowsEnd.FINISHED

