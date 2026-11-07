"""The SEO keyword metrics table (``shared.seo_keyword_metrics``): row shape, round trip, batched reads and writes."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock

from shared.seo_keyword_metrics import load_metric_items, metric_item, metric_json, put_metric_items
from shared.utils import keyword_id
from testing.seo_fixtures import empty_metric, keyword_metric

FETCHED_AT = '2026-10-02T09:00:00.000000Z'
EMPTY_METRIC = empty_metric()


class TestMetricItem:
    def test_keys_the_row_on_the_keyword_identity_and_market(self):
        item = metric_item(keyword_metric('Cheap Flights '), 'cl-es', FETCHED_AT)

        assert (item['keyword_id'], item['market_id']) == (keyword_id('cheap flights'), 'cl-es')

    def test_stores_fractional_numbers_as_decimals(self):
        item = metric_item(keyword_metric(), 'global', FETCHED_AT)

        assert (item['cpc'], item['competition']) == (Decimal('1.25'), Decimal('0.5'))

    def test_leaves_out_every_metric_the_provider_did_not_return(self):
        item = metric_item(EMPTY_METRIC, 'global', FETCHED_AT)

        assert sorted(item) == ['fetched_at', 'keyword', 'keyword_id', 'market_id', 'monthly_searches', 'source']


class TestMetricJson:
    def test_round_trips_a_full_metric(self):
        assert metric_json(metric_item(keyword_metric(), 'global', FETCHED_AT)) == {
            'keyword_id': keyword_id('cheap flights'), 'keyword': 'cheap flights', 'market_id': 'global',
            'search_volume': 1900, 'monthly_searches': [{'year': 2026, 'month': 9, 'search_volume': 2100}],
            'keyword_difficulty': 41, 'cpc': 1.25, 'competition': 0.5, 'competition_level': 'MEDIUM',
            'intent': 'commercial', 'source': 'labs', 'fetched_at': FETCHED_AT,
        }

    def test_reads_absent_metrics_as_null(self):
        decoded = metric_json(metric_item(EMPTY_METRIC, 'global', FETCHED_AT))

        assert [decoded[name] for name in ('search_volume', 'keyword_difficulty', 'cpc', 'intent')] == [None] * 4

    def test_reads_decimal_numbers_from_dynamodb(self):
        decoded = metric_json({'search_volume': Decimal(320), 'cpc': Decimal('0.75'), 'keyword_difficulty': Decimal(12)})

        assert (decoded['search_volume'], decoded['cpc'], decoded['keyword_difficulty']) == (320, 0.75, 12)

    def test_skips_a_malformed_month(self):
        decoded = metric_json({'monthly_searches': [{'year': Decimal(2026), 'month': Decimal(8)}, 'x']})

        assert decoded['monthly_searches'] == []


class TestPutMetricItems:
    def test_writes_every_row_through_one_batch_writer_keyed_on_keyword_and_market(self):
        table = MagicMock()
        items = [metric_item(keyword_metric(text), 'global', FETCHED_AT) for text in ('a', 'b')]

        put_metric_items(table, items)

        writer = table.batch_writer.return_value.__enter__.return_value
        assert (table.batch_writer.call_args.kwargs, writer.put_item.call_count) == (
            {'overwrite_by_pkeys': ['keyword_id', 'market_id']}, 2,
        )


class TestLoadMetricItems:
    def test_reads_100_keys_per_batch_get(self):
        resource = MagicMock()
        resource.batch_get_item.return_value = {'Responses': {'metrics': []}}

        load_metric_items(resource, 'metrics', [f'id-{index}' for index in range(250)], 'global')

        sizes = [len(call.kwargs['RequestItems']['metrics']['Keys']) for call in resource.batch_get_item.call_args_list]
        assert sizes == [100, 100, 50]

    def test_returns_found_rows_in_request_order_without_missing_ids(self):
        resource = MagicMock()
        resource.batch_get_item.return_value = {'Responses': {'metrics': [{'keyword_id': 'b'}, {'keyword_id': 'a'}]}}

        rows = load_metric_items(resource, 'metrics', ['a', 'missing', 'b', 'a'], 'cl-es')

        assert [row['keyword_id'] for row in rows] == ['a', 'b']

    def test_asks_for_the_requested_market(self):
        resource = MagicMock()
        resource.batch_get_item.return_value = {'Responses': {}}

        load_metric_items(resource, 'metrics', ['a'], 'cl-es')

        assert resource.batch_get_item.call_args.kwargs['RequestItems']['metrics']['Keys'] == [{'keyword_id': 'a', 'market_id': 'cl-es'}]
