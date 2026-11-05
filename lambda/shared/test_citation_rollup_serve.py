"""Tests for serving ``/citations`` pages from the citation rollup (``shared.citation_rollup_serve``).

One build over 2,500 distinct URLs (three chunks) is read back through
``RollupReader``; every page must equal what the live aggregation lists for
the same query.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from shared.citation_pages import DICT_VIEW, CitationQuery, aggregate_citations, list_entry
from shared.citation_rollup import CURRENT_KEY, REBUILD_MARKER_KEY, keyword_fingerprint
from shared.citation_rollup_serve import PageRequest, RollupReader
from testing.citation_rollup_fixtures import (
    ROLLUP_BUCKET,
    ROLLUP_TEST_ROWS,
    FakeS3,
    published_rollup,
    rollup_bucket_fixture,
    rollup_keywords,
)

_ROWS = ROLLUP_TEST_ROWS
_TOP_URLS = aggregate_citations(_ROWS, []).top_urls
_BRAND_UPDATED_AT = '2026-11-01T00:00:00Z'


@pytest.fixture(scope='module')
def published() -> dict[str, bytes]:
    return published_rollup(_ROWS, rollup_keywords(20, groups={i: {'coast'} for i in range(10)}), {'updated_at': _BRAND_UPDATED_AT})


s3 = rollup_bucket_fixture()


@pytest.fixture
def reader(s3) -> RollupReader:
    return RollupReader(s3, ROLLUP_BUCKET, lambda_client=MagicMock(), function_name='CitationAnalysis-GenerateSummary')


def _table_page(reader: RollupReader, query: CitationQuery, start: int = 0, limit: int = 25, *, keywords: bool = False) -> dict:
    lookup = reader.lookup('table', None, _BRAND_UPDATED_AT)
    assert lookup.scope is not None
    return reader.page(lookup.scope, PageRequest(query=query, start=start, limit=limit, include_keywords=keywords))


def _live(query: CitationQuery, start: int = 0, limit: int = 25, *, keywords: bool = False) -> list[dict]:
    return [list_entry(entry, keywords) for entry in query.apply(_TOP_URLS, DICT_VIEW)[start:start + limit]]


class TestPages:
    def test_lists_the_first_default_page_like_the_live_read(self, reader):
        assert _table_page(reader, CitationQuery())['top_urls'] == _live(CitationQuery())

    def test_lists_a_page_that_straddles_two_chunks_like_the_live_read(self, reader):
        assert _table_page(reader, CitationQuery(), start=990, limit=25)['top_urls'] == _live(CitationQuery(), 990)

    def test_lists_one_content_type_like_the_live_read(self, reader):
        query = CitationQuery(content_type='video')

        assert _table_page(reader, query, start=100)['top_urls'] == _live(query, 100)

    def test_lists_another_order_and_filter_like_the_live_read(self, reader):
        query = CitationQuery(sort='domain', order='asc', url_contains='SITE-3', min_citations=2)

        assert _table_page(reader, query, start=40, limit=60)['top_urls'] == _live(query, 40, 60)

    def test_lists_keyword_texts_when_asked_on_another_order(self, reader):
        query = CitationQuery(sort='keywords')

        assert _table_page(reader, query, keywords=True)['top_urls'] == _live(query, keywords=True)

    def test_counts_matching_urls_and_points_at_the_next_page(self, reader):
        page = _table_page(reader, CitationQuery(min_citations=5), limit=10)

        assert (page['matched_urls'], page['next_token'] is not None) == (sum(e['citation_count'] >= 5 for e in _TOP_URLS), True)

    def test_answers_an_empty_last_page_past_the_end(self, reader):
        page = _table_page(reader, CitationQuery(), start=5_000)

        assert (page['top_urls'], page['next_token']) == ([], None)

    def test_carries_the_scope_wide_totals_of_the_live_read(self, reader):
        page = _table_page(reader, CitationQuery(url_contains='site-1'))

        assert page['total_urls'] == aggregate_citations(_ROWS, []).totals()['total_urls']


class TestReadCost:
    def test_reads_the_pointer_manifest_and_one_chunk_for_the_dashboard_page(self, reader, s3):
        _table_page(reader, CitationQuery(), limit=25)

        assert [key.rsplit('/', 2)[-1] for key in s3.reads] == ['current.json', 'manifest.json.gz', '0.json.gz']

    def test_reads_nothing_again_for_the_next_sort_click_on_a_warm_container(self, reader, s3):
        _table_page(reader, CitationQuery(sort='domain'))
        reads = len(s3.reads)

        _table_page(reader, CitationQuery(sort='domain', order='asc'), start=25)

        assert len(s3.reads) == reads


class TestLookup:
    def test_serves_a_scope_whose_keywords_and_brand_config_match(self, reader):
        lookup = reader.lookup('group:coast', keyword_fingerprint(f'keyword {i:03d}' for i in range(10)), _BRAND_UPDATED_AT)

        assert (lookup.scope is not None, lookup.stale) == (True, False)

    def test_is_stale_when_the_scope_keywords_changed_since_the_build(self, reader):
        lookup = reader.lookup('group:coast', keyword_fingerprint(['keyword 000']), _BRAND_UPDATED_AT)

        assert (lookup.scope, lookup.stale) == (None, True)

    def test_is_stale_when_the_brand_config_changed_since_the_build(self, reader):
        lookup = reader.lookup('table', None, '2026-11-04T00:00:00Z')

        assert (lookup.scope, lookup.stale) == (None, True)

    def test_is_not_stale_before_the_first_build(self):
        lookup = RollupReader(FakeS3(), ROLLUP_BUCKET).lookup('table', None, None)

        assert (lookup.scope, lookup.stale) == (None, False)

    def test_reads_the_pointer_once_within_its_time_to_live(self, reader, s3):
        reader.lookup('table', None, _BRAND_UPDATED_AT)
        reader.lookup('all', None, _BRAND_UPDATED_AT)

        assert s3.reads.count(CURRENT_KEY) == 1


class TestRequestRebuild:
    def test_invokes_the_builder_asynchronously_with_the_rollup_action(self, s3):
        lambda_client = MagicMock()
        reader = RollupReader(s3, ROLLUP_BUCKET, lambda_client=lambda_client, function_name='CitationAnalysis-GenerateSummary')

        reader.request_rebuild('stale table')

        lambda_client.invoke.assert_called_once_with(
            FunctionName='CitationAnalysis-GenerateSummary', InvocationType='Event',
            Payload=json.dumps({'action': 'build_citation_rollup', 'reason': 'stale table'}).encode('utf-8'),
        )

    def test_requests_one_rebuild_for_a_burst_of_stale_reads(self, reader):
        results = [reader.request_rebuild('stale table') for _ in range(5)]

        assert results == [True, False, False, False, False]

    def test_skips_the_rebuild_another_container_requested_minutes_ago(self, s3):
        s3.objects[REBUILD_MARKER_KEY] = json.dumps({'requested_at': 1_000.0}).encode()
        reader = RollupReader(s3, ROLLUP_BUCKET, lambda_client=MagicMock(), function_name='f', wall_clock=lambda: 1_100.0)

        assert reader.request_rebuild('stale table') is False

    def test_requests_a_rebuild_once_the_other_containers_request_is_old(self, s3):
        s3.objects[REBUILD_MARKER_KEY] = json.dumps({'requested_at': 1_000.0}).encode()
        reader = RollupReader(s3, ROLLUP_BUCKET, lambda_client=MagicMock(), function_name='f', wall_clock=lambda: 2_000.0)

        assert reader.request_rebuild('stale table') is True
