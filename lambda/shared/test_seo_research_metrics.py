"""``shared.seo_keyword_metrics.persist_research_rows``: fresh research rows stored as keyword metrics (review #9)."""

from __future__ import annotations

import logging

from botocore.exceptions import ClientError

from shared.dataforseo_keywords import KeywordMetric, KeywordRow, MonthlySearch
from shared.seo_keyword_metrics import persist_research_rows, research_metric
from shared.utils import keyword_id
from testing.seo_fixtures import FakeMetricsTable

FETCHED_AT = '2026-10-02T09:00:00.000000Z'
TREND = (MonthlySearch(year=2026, month=9, search_volume=900),)
ROW = KeywordRow(keyword='cheap flights to acme', search_volume=880, trend=TREND, keyword_difficulty=33, cpc=0.8,
                 competition=0.4, intent='commercial')


def test_maps_trend_to_monthly_searches_and_leaves_competition_level_empty():
    assert research_metric(ROW, 'labs') == KeywordMetric(
        keyword='cheap flights to acme', search_volume=880, monthly_searches=TREND, keyword_difficulty=33, cpc=0.8,
        competition=0.4, competition_level=None, intent='commercial', source='labs',
    )


def test_writes_one_item_per_row_keyed_on_keyword_identity_and_market():
    table = FakeMetricsTable()

    written = persist_research_rows(table, [ROW, KeywordRow('Hotels In Acme', None, (), None, None, None, 'unknown')],
                                    'cl-es', 'google_ads', FETCHED_AT)

    assert (written, [(item['keyword_id'], item['market_id']) for item in table.items]) == (
        2, [(keyword_id('cheap flights to acme'), 'cl-es'), (keyword_id('hotels in acme'), 'cl-es')],
    )


def test_writes_through_one_batch_writer_that_dedupes_on_the_key():
    table = FakeMetricsTable()

    persist_research_rows(table, [ROW], 'global', 'labs', FETCHED_AT)

    assert table.batch_writer_options == [{'overwrite_by_pkeys': ['keyword_id', 'market_id']}]


def test_skips_rows_whose_keyword_has_no_identity():
    table = FakeMetricsTable()

    written = persist_research_rows(table, [KeywordRow('   ', 10, (), None, None, None, 'unknown')], 'global', 'labs',
                                    FETCHED_AT)

    assert (written, table.batch_writer_options) == (0, [])


def test_returns_zero_and_logs_when_the_write_fails(caplog):
    caplog.set_level(logging.WARNING, logger='shared.seo_keyword_metrics')
    table = FakeMetricsTable(error=ClientError({'Error': {'Code': 'ProvisionedThroughputExceededException'}}, 'BatchWriteItem'))

    written = persist_research_rows(table, [ROW], 'global', 'labs', FETCHED_AT)

    assert (written, caplog.messages) == (
        0, ['seo_keyword_metrics.research-persist-failed market_id=global rows=1 error=ClientError'],
    )
