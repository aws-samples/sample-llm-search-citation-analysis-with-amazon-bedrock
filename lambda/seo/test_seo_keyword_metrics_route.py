"""``POST /api/seo/keywords/metrics`` and ``.../metrics/lookup`` (``seo-keyword-metrics.py``)."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock, patch

from shared.utils import keyword_id
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.seo_fixtures import GLOBAL_CODES, SEO_DIR, SEO_ENV, empty_metric, keyword_metric, seo_event

metrics_module = handler_fixture(SEO_DIR, 'seo-keyword-metrics.py', 'seo_keyword_metrics_under_test', env=SEO_ENV)

FULL = keyword_metric()
NO_DATA = empty_metric('hotels')


class Metrics:
    """One request, with DataForSEO, the market codes and the metrics table stubbed."""

    def __init__(self, module, path, body, *, metrics=(FULL,), stored=(), keywords=()):
        self.keyword_metrics = MagicMock(return_value=(list(metrics), 0.012))
        self.metrics_table = MagicMock()
        self.resource = MagicMock()
        self.resource.batch_get_item.return_value = {
            'Responses': {'test-seo-keyword-metrics': list(stored), 'test-keywords': list(keywords)},
        }
        with patch.multiple(
            module, keyword_metrics=self.keyword_metrics, market_codes=MagicMock(return_value=GLOBAL_CODES),
            metrics_table=self.metrics_table, dynamodb=self.resource,
        ):
            self.status, self.body = parse_response(module.handler(seo_event('POST', path, body=body), {}))

    @property
    def written(self) -> list[dict]:
        writer = self.metrics_table.batch_writer.return_value.__enter__.return_value
        return [call.kwargs['Item'] for call in writer.put_item.call_args_list]


def fetch(module, body, **kwargs):
    return Metrics(module, '/api/seo/keywords/metrics', body, **kwargs)


def lookup(module, body, **kwargs):
    return Metrics(module, '/api/seo/keywords/metrics/lookup', body, **kwargs)


class TestFetchMetrics:
    def test_asks_dataforseo_once_for_the_deduplicated_keywords(self, metrics_module):
        call = fetch(metrics_module, {'keywords': ['Cheap Flights', 'cheap flights ', 'hotels']})

        assert call.keyword_metrics.call_args.args == (['cheap flights', 'hotels'], GLOBAL_CODES)

    def test_stores_every_returned_metric_under_its_keyword_identity(self, metrics_module):
        call = fetch(metrics_module, {'keywords': ['cheap flights', 'hotels'], 'market_id': 'cl-es'},
                     metrics=(keyword_metric(), NO_DATA))

        assert [(item['keyword_id'], item['market_id']) for item in call.written] == [
            (keyword_id('cheap flights'), 'cl-es'), (keyword_id('hotels'), 'cl-es'),
        ]

    def test_writes_a_keyword_without_data_with_its_metrics_absent(self, metrics_module):
        written = fetch(metrics_module, {'keywords': ['hotels']}, metrics=(NO_DATA,)).written

        assert 'search_volume' not in written[0]

    def test_answers_null_for_a_metric_the_provider_did_not_return(self, metrics_module):
        call = fetch(metrics_module, {'keywords': ['Hotels']}, metrics=[NO_DATA])

        assert (call.status, call.body['market_id'], call.body['metrics'][0]['search_volume']) == (200, 'global', None)

    def test_answers_the_fetch_time_as_utc(self, metrics_module):
        call = fetch(metrics_module, {'keywords': ['cheap flights']})

        assert call.body['metrics'][0]['fetched_at'].endswith('Z')

    def test_refuses_more_than_700_keywords_before_any_paid_call(self, metrics_module):
        call = fetch(metrics_module, {'keywords': [f'keyword {index}' for index in range(701)]})

        assert (call.status, call.body['code'], call.keyword_metrics.call_count) == (400, 'VALIDATION_ERROR', 0)

    def test_refuses_an_empty_keyword_list(self, metrics_module):
        call = fetch(metrics_module, {'keywords': []})

        assert (call.status, call.body['field']) == (400, 'keywords')

    def test_refuses_a_market_that_is_not_configured_before_any_paid_call(self, metrics_module):
        call = fetch(metrics_module, {'keywords': ['x'], 'market_id': 'br-pt'})

        assert (call.status, call.body['field'], call.keyword_metrics.call_count) == (400, 'market_id', 0)


class TestLookupMetrics:
    def test_answers_the_stored_rows_without_a_dataforseo_call(self, metrics_module):
        stored = {'keyword_id': 'kw-1', 'market_id': 'global', 'keyword': 'x', 'search_volume': Decimal(70), 'source': 'labs'}
        call = lookup(metrics_module, {'keyword_ids': ['kw-1', 'kw-2']}, stored=[stored])

        assert ([metric['search_volume'] for metric in call.body['metrics']], call.keyword_metrics.call_count) == ([70], 0)

    def test_finds_an_older_keyword_through_its_text_and_answers_its_listed_id(self, metrics_module):
        # Keywords stored before keyword identities keep a random id; their rows are keyed by keyword_id(text).
        stored = {'keyword_id': keyword_id('hotels'), 'market_id': 'global', 'keyword': 'hotels',
                  'search_volume': Decimal(9000), 'source': 'labs'}
        call = lookup(metrics_module, {'keyword_ids': ['kw-old']}, stored=[stored],
                      keywords=[{'id': 'kw-old', 'keyword': 'hotels'}])

        assert [(metric['keyword_id'], metric['search_volume']) for metric in call.body['metrics']] == [('kw-old', 9000)]

    def test_reads_the_requested_market(self, metrics_module):
        call = lookup(metrics_module, {'keyword_ids': ['kw-1'], 'market_id': 'cl-es'})

        keys = call.resource.batch_get_item.call_args.kwargs['RequestItems']['test-seo-keyword-metrics']['Keys']
        assert (keys, call.body['market_id']) == ([{'keyword_id': 'kw-1', 'market_id': 'cl-es'}], 'cl-es')

    def test_refuses_more_than_500_ids(self, metrics_module):
        call = lookup(metrics_module, {'keyword_ids': [f'kw-{index}' for index in range(501)]})

        assert (call.status, call.body['code'], call.body['field']) == (400, 'VALIDATION_ERROR', 'keyword_ids')

    def test_never_routes_a_lookup_to_the_paid_fetch(self, metrics_module):
        call = lookup(metrics_module, {'keyword_ids': ['kw-1']})

        assert (call.status, call.keyword_metrics.call_count, call.written) == (200, 0, [])
