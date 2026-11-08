"""``GET /api/seo/seo-geo`` (``seo-geo.py``): keyword scope, run lookup, search volumes, snapshot traffic and the table."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock, patch

import seo_geo_data

from shared import kpi_engine
from shared.seo_geo import AIO_PROVIDER
from shared.utils import keyword_id
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.seo_domain_fixtures import (
    SNAPSHOT_AT,
    SNAPSHOT_ENV,
    FakeS3,
    FakeSnapshots,
    snapshot_object,
    stored_snapshot,
)
from testing.seo_fixtures import (
    OLDER_RUN_TS,
    RUN_TS,
    SEO_DIR,
    SEO_ENV,
    FakeSearchResults,
    aio_row,
    answer_row,
    keyword_item,
    organic_result,
    seo_event,
)

geo_module = handler_fixture(SEO_DIR, 'seo-geo.py', 'seo_geo_under_test', env={**SEO_ENV, **SNAPSHOT_ENV})

FLIGHTS = keyword_item('cheap flights', keyword_id='kw-flights', group_ids={'grp-travel'})
HOTELS = keyword_item('hotels', keyword_id='kw-hotels')
CHILE_ONLY = keyword_item('vuelos baratos', keyword_id='kw-vuelos', market_id='cl-es')
RANKED = [organic_result(2, 'https://example.com/flights'), organic_result(1, 'https://acme.example.org/')]
RESULTS = [
    aio_row(search_results=RANKED, timestamp=OLDER_RUN_TS),
    answer_row('openai', mentions_brand=True, timestamp=OLDER_RUN_TS),
    aio_row(search_results=RANKED),
    answer_row('openai', mentions_brand=False),
    answer_row('claude', mentions_brand=False),
]
OWNED_SNAPSHOT = stored_snapshot('example.com')
ACME_SNAPSHOT = stored_snapshot('acme.example.org')
SNAPSHOT_OBJECTS = {
    OWNED_SNAPSHOT['keywords_s3_key']: snapshot_object(('Cheap Flights', 2, 300.0), ('hotels', 14, 100.0)),
    ACME_SNAPSHOT['keywords_s3_key']: snapshot_object(('cheap flights', 1, 600.0)),
}


class SeoGeo:
    """One request over stubbed Keywords, SearchResults, BrandConfig, metrics and snapshot sources."""

    def __init__(self, module, query=None, *, keywords=(FLIGHTS, HOTELS, CHILE_ONLY), results=RESULTS, volumes=None,
                 snapshots=(), objects=None):
        keywords_table = MagicMock()
        keywords_table.query.return_value = {'Items': [dict(item) for item in keywords]}
        stored = [{'keyword_id': key, 'market_id': 'global', 'search_volume': Decimal(volume)} for key, volume in (volumes or {}).items()]
        self.resource = MagicMock()
        self.resource.batch_get_item.return_value = {'Responses': {'test-seo-keyword-metrics': stored}}
        sources = seo_geo_data.Sources(
            keywords=keywords_table, search_results=FakeSearchResults(results), snapshots=FakeSnapshots(snapshots),
            dynamodb=self.resource, s3=FakeS3(objects), bucket='test-raw-responses',
        )
        with patch.object(seo_geo_data, 'sources', return_value=sources):
            self.status, self.body = parse_response(module.handler(seo_event('GET', '/api/seo/seo-geo', query=query), {}))

    def row(self, keyword_id: str) -> dict:
        return next(row for row in self.body['rows'] if row['keyword_id'] == keyword_id)


def with_snapshots(module, **options):
    return SeoGeo(module, snapshots=(OWNED_SNAPSHOT, ACME_SNAPSHOT), objects=SNAPSHOT_OBJECTS, **options)


class TestScope:
    def test_covers_the_active_keywords_of_the_global_market_by_default(self, geo_module):
        call = SeoGeo(geo_module)

        assert (call.status, sorted(row['keyword_id'] for row in call.body['rows'])) == (200, ['kw-flights', 'kw-hotels'])

    def test_covers_only_the_requested_market(self, geo_module):
        call = SeoGeo(geo_module, {'market_id': 'cl-es'})

        assert ([row['keyword_id'] for row in call.body['rows']], call.body['market_id']) == (['kw-vuelos'], 'cl-es')

    def test_covers_only_the_requested_group(self, geo_module):
        call = SeoGeo(geo_module, {'group_id': 'grp-travel'})

        assert ([row['keyword_id'] for row in call.body['rows']], call.body['group_id']) == (['kw-flights'], 'grp-travel')

    def test_refuses_a_market_that_is_not_configured(self, geo_module):
        call = SeoGeo(geo_module, {'market_id': 'br-pt'})

        assert (call.status, call.body['code'], call.body['field']) == (400, 'VALIDATION_ERROR', 'market_id')


class TestRows:
    def test_reads_the_latest_run_with_an_ai_overviews_row(self, geo_module):
        row = SeoGeo(geo_module).row('kw-flights')

        assert (row['last_run'], row['answers'], row['ai_mention_rate']) == (RUN_TS, 3, 0.0)

    def test_places_a_top_ranked_brand_the_engines_ignore_in_the_ai_gap(self, geo_module):
        row = SeoGeo(geo_module).row('kw-flights')

        assert (row['organic_position'], row['competitor_positions'], row['quadrant']) == (2, {'Acme': 1}, 'ai_gap')

    def test_reports_no_data_for_a_keyword_never_run_with_ai_overviews(self, geo_module):
        row = SeoGeo(geo_module).row('kw-hotels')

        assert (row['quadrant'], row['ai_overview_shown'], row['last_run']) == ('no_data', None, None)

    def test_reads_the_search_volume_from_the_metrics_table(self, geo_module):
        call = SeoGeo(geo_module, volumes={'kw-flights': 2400})

        assert (call.row('kw-flights')['search_volume'], call.row('kw-hotels')['search_volume']) == (2400, None)

    def test_reads_the_volume_of_an_older_keyword_stored_under_its_text_identity(self, geo_module):
        # Keywords stored before keyword identities keep a random id; metric rows are keyed by keyword_id(text).
        call = SeoGeo(geo_module, volumes={keyword_id('hotels'): 9000})

        assert call.row('kw-hotels')['search_volume'] == 9000


class TestSnapshotTraffic:
    def test_reads_the_estimated_traffic_of_the_keyword_case_insensitively(self, geo_module):
        assert with_snapshots(geo_module).row('kw-flights')['estimated_traffic'] == 300.0

    def test_falls_back_to_the_snapshot_position_beyond_the_top_10(self, geo_module):
        row = with_snapshots(geo_module).row('kw-hotels')

        assert (row['organic_position'], row['ranked_position'], row['organic_position_source']) == (None, 14, 'ranked_keywords')

    def test_compares_traffic_share_with_share_of_voice(self, geo_module):
        comparison = with_snapshots(geo_module).body['traffic_comparison']

        assert [(entry['name'], entry['traffic_share']) for entry in comparison] == [('You', 40.0), ('Acme', 60.0)]

    def test_reports_the_newest_owned_snapshot_time(self, geo_module):
        assert with_snapshots(geo_module).body['traffic_snapshot_at'] == SNAPSHOT_AT

    def test_answers_without_traffic_when_no_snapshot_exists(self, geo_module):
        call = SeoGeo(geo_module)

        assert ([entry['estimated_traffic'] for entry in call.body['traffic_comparison']], call.body['traffic_snapshot_at']) == ([None, None], None)


class TestTable:
    def test_sorts_the_largest_search_volume_first(self, geo_module):
        call = SeoGeo(geo_module, volumes={'kw-hotels': 9000, 'kw-flights': 10})

        assert [row['keyword_id'] for row in call.body['rows']] == ['kw-hotels', 'kw-flights']

    def test_summarizes_the_quadrants(self, geo_module):
        assert SeoGeo(geo_module).body['summary'] == {'both_strong': 0, 'ai_gap': 1, 'seo_gap': 0, 'both_weak': 0, 'no_data': 1}

    def test_reports_the_thresholds(self, geo_module):
        assert SeoGeo(geo_module).body['thresholds'] == {'seo_top_position': 10, 'geo_mention_rate': 50}

    def test_answers_an_empty_table_without_keywords(self, geo_module):
        call = SeoGeo(geo_module, keywords=())

        assert (call.status, call.body['rows'], call.resource.batch_get_item.call_count) == (200, [], 0)


def test_kpi_engine_counts_google_ai_overview_answers_without_a_test_patch():
    assert AIO_PROVIDER in kpi_engine.LLM_PROVIDERS
