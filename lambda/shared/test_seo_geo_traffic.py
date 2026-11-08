"""SEO vs GEO with estimated traffic (``shared.seo_geo``, ``shared.seo_geo_traffic``): signals and the share comparison."""

from __future__ import annotations

from decimal import Decimal

import pytest

from shared import kpi_engine
from shared.seo_geo import AIO_PROVIDER, OrganicSignals, seo_geo_row
from shared.seo_geo_traffic import SearchTraffic, merge_traffic, organic_signals, seo_geo_rows, traffic_comparison
from testing.seo_fixtures import COMPETITOR_DOMAINS, OWNED_DOMAINS, aio_row, answer_row, keyword_item, organic_result

FLIGHTS = keyword_item('cheap flights', keyword_id='kw-flights')
HOTELS = keyword_item('hotels', keyword_id='kw-hotels')
TRAFFIC = SearchTraffic(
    owned={'cheap flights': (2, 300.0), 'hotels': (14, 100.0), 'cars': (1, 5000.0)},
    competitors={'Acme': {'cheap flights': (1, 600.0)}},
)


@pytest.fixture(autouse=True)
def aio_is_an_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(kpi_engine, 'LLM_PROVIDERS', sorted({*kpi_engine.LLM_PROVIDERS, AIO_PROVIDER}))


def row_with(run, signals: OrganicSignals | None = None):
    return seo_geo_row(FLIGHTS, run, owned_domains=OWNED_DOMAINS, competitor_domains=COMPETITOR_DOMAINS,
                       search_volume=None, signals=signals)


class TestOrganicSource:
    def test_is_the_top_10_when_the_results_page_ranks_you(self):
        row = row_with([aio_row(search_results=[organic_result(4, 'https://example.com/')])], OrganicSignals(snapshot_position=6))

        assert (row['organic_position'], row['organic_position_source']) == (4, 'serp_top10')

    def test_is_the_snapshot_when_the_results_page_does_not_rank_you(self):
        row = row_with([aio_row()], OrganicSignals(snapshot_position=23))

        assert (row['ranked_position'], row['organic_position_source']) == (23, 'ranked_keywords')

    def test_prefers_a_tracked_position_over_the_snapshot(self):
        row = row_with([aio_row()], OrganicSignals(snapshot_position=23, tracked_position=18))

        assert (row['ranked_position'], row['organic_position_source']) == (18, 'rank_tracking')

    def test_is_none_without_any_position(self):
        assert row_with([aio_row()])['organic_position_source'] is None

    def test_keeps_the_quadrant_on_the_results_page_position(self):
        row = row_with([aio_row(), answer_row('openai', mentions_brand=False)], OrganicSignals(snapshot_position=3))

        assert row['quadrant'] == 'both_weak'

    def test_reports_the_signals_without_an_ai_overviews_run(self):
        row = row_with([], OrganicSignals(estimated_traffic=12.5, snapshot_position=40))

        assert (row['estimated_traffic'], row['ranked_position'], row['quadrant']) == (12.5, 40, 'no_data')


class TestCitedCompetitors:
    def test_lists_a_competitor_cited_on_a_subdomain(self):
        assert row_with([aio_row(citations=['https://blog.acme.example.org/x'])])['ai_overview_cited_competitors'] == ['Acme']

    def test_is_empty_without_an_ai_overviews_run(self):
        assert row_with([])['ai_overview_cited_competitors'] == []


class TestSignals:
    def test_reads_the_owned_snapshot_by_keyword_text(self):
        assert organic_signals(FLIGHTS, TRAFFIC, None) == OrganicSignals(estimated_traffic=300.0, snapshot_position=2)

    def test_reads_a_rank_tracked_position_by_keyword_id(self):
        assert organic_signals(FLIGHTS, None, {'kw-flights': 9}).tracked_position == 9

    def test_merging_keeps_the_best_position_and_sums_traffic(self):
        assert merge_traffic([{'a': (5, 10.0)}, {'a': (3, None)}, {'a': (None, 2.5)}]) == {'a': (3, 12.5)}

    def test_rows_carry_the_traffic_and_sort_by_volume(self):
        rows = seo_geo_rows([FLIGHTS, HOTELS], [[], []], owned_domains=OWNED_DOMAINS, competitor_domains=COMPETITOR_DOMAINS,
                            volumes={'kw-hotels': 900}, traffic=TRAFFIC)

        assert [(row['keyword'], row['estimated_traffic']) for row in rows] == [('hotels', 100.0), ('cheap flights', 300.0)]


class TestTrafficComparison:
    RUNS = ([aio_row(brands=[{'name': 'Acme', 'classification': 'competitor', 'rank': Decimal(2)}]), answer_row('openai', mentions_brand=True)], [])

    def test_shares_the_scope_traffic_between_you_and_the_competitors(self):
        comparison = traffic_comparison([FLIGHTS, HOTELS], self.RUNS, TRAFFIC, ['Acme'])

        assert [(entry['estimated_traffic'], entry['traffic_share']) for entry in comparison] == [(400.0, 40.0), (600.0, 60.0)]

    def test_sets_share_of_voice_beside_each_traffic_share(self):
        comparison = traffic_comparison([FLIGHTS], self.RUNS, TRAFFIC, ['Acme'])

        assert [(entry['name'], entry['owned'], entry['share_of_voice']) for entry in comparison] == [('You', True, 50.0), ('Acme', False, 50.0)]

    def test_reports_no_traffic_for_a_competitor_without_a_snapshot(self):
        comparison = traffic_comparison([FLIGHTS], self.RUNS, TRAFFIC, ['Acme', 'Example Rail'])

        assert (comparison[2]['estimated_traffic'], comparison[2]['traffic_share'], comparison[2]['share_of_voice']) == (None, None, 0.0)

    def test_has_no_share_without_any_traffic(self):
        comparison = traffic_comparison([FLIGHTS], ([], []), SearchTraffic(), ['Acme'])

        assert [(entry['traffic_share'], entry['share_of_voice']) for entry in comparison] == [(None, None), (None, None)]
