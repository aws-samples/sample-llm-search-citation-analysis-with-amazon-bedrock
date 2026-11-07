"""SEO vs GEO v1 rules (``shared.seo_geo``): run selection, organic positions, AI visibility, quadrants."""

from __future__ import annotations

import pytest

from shared import kpi_engine
from shared.insights_citations import competitor_domains_from
from shared.seo_geo import (
    AIO_PROVIDER,
    citation_overlap,
    latest_aio_run,
    organic_entries,
    quadrant,
    seo_geo_row,
    sort_rows,
    summarize,
)
from testing.seo_fixtures import (
    COMPETITOR_DOMAINS,
    OLDER_RUN_TS,
    OWNED_DOMAINS,
    RUN_TS,
    aio_row,
    answer_row,
    keyword_item,
    organic_result,
)


@pytest.fixture(autouse=True)
def aio_is_an_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    """``google_ai_overview`` is an LLM provider (an answer engine), whether or not ``shared.config`` lists it yet."""
    monkeypatch.setattr(kpi_engine, 'LLM_PROVIDERS', sorted({*kpi_engine.LLM_PROVIDERS, AIO_PROVIDER}))


def row_for(run, *, owned=OWNED_DOMAINS, competitors=COMPETITOR_DOMAINS, volume: int | None = 1900):
    return seo_geo_row(keyword_item(), run, owned_domains=owned, competitor_domains=competitors, search_volume=volume)


RANKED_TOP_3 = [organic_result(3, 'https://www.example.com/flights'), organic_result(1, 'https://acme.example.org/')]


class TestLatestAioRun:
    def test_picks_the_newest_run_with_an_ai_overviews_row(self):
        rows = [aio_row(timestamp=OLDER_RUN_TS), answer_row('openai', mentions_brand=True), aio_row()]

        assert latest_aio_run(rows)[0] == RUN_TS

    def test_keeps_every_row_of_that_run_and_none_of_older_ones(self):
        rows = [answer_row('openai', mentions_brand=True, timestamp=OLDER_RUN_TS), aio_row(), answer_row('claude', mentions_brand=False)]

        assert [row['provider'] for row in latest_aio_run(rows)[1]] == [AIO_PROVIDER, 'claude']

    def test_ignores_a_newer_run_whose_ai_overviews_call_failed(self):
        rows = [aio_row(timestamp=OLDER_RUN_TS), aio_row(status='error')]

        assert latest_aio_run(rows)[0] == OLDER_RUN_TS

    def test_returns_no_run_when_no_run_has_an_ai_overviews_row(self):
        assert latest_aio_run([answer_row('openai', mentions_brand=True)]) == (None, [])


class TestOrganicPosition:
    def test_is_the_best_position_of_an_owned_domain(self):
        run = [aio_row(search_results=[organic_result(7, 'https://example.com/a'), organic_result(4, 'https://example.com/b')])]

        assert row_for(run)['organic_position'] == 4

    def test_counts_a_subdomain_of_an_owned_domain(self):
        run = [aio_row(search_results=[organic_result(2, 'https://shop.example.com/deals')])]

        assert row_for(run)['organic_position'] == 2

    def test_strips_www_from_the_result_domain(self):
        run = [aio_row(search_results=[organic_result(5, 'https://www.example.com/', domain='www.example.com')])]

        assert row_for(run)['organic_position'] == 5

    def test_never_matches_a_lookalike_domain(self):
        run = [aio_row(search_results=[organic_result(1, 'https://notexample.com/')])]

        assert row_for(run)['organic_position'] is None

    def test_is_none_without_owned_domains(self):
        assert row_for([aio_row(search_results=RANKED_TOP_3)], owned=())['organic_position'] is None

    def test_reads_the_domain_from_the_url_when_the_result_has_none(self):
        assert organic_entries([{'url': 'https://example.com/x', 'position': 6}]) == [(6, 'example.com', 'https://example.com/x')]


class TestCompetitorPositions:
    def test_reports_each_competitor_best_position(self):
        assert row_for([aio_row(search_results=RANKED_TOP_3)])['competitor_positions'] == {'Acme': 1}

    def test_reports_none_for_a_competitor_outside_the_top_10(self):
        run = [aio_row(search_results=[organic_result(3, 'https://example.com/')])]

        assert row_for(run)['competitor_positions'] == {'Acme': None}

    def test_leaves_out_a_competitor_without_domains(self):
        competitors = competitor_domains_from({'competitor_domains': {'Acme': ['acme.example.org'], 'Example Rail': []}})

        assert row_for([aio_row(search_results=RANKED_TOP_3)], competitors=competitors)['competitor_positions'] == {'Acme': 1}

    def test_reports_none_for_every_competitor_without_an_ai_overviews_row(self):
        assert row_for([answer_row('openai', mentions_brand=True)])['competitor_positions'] == {'Acme': None}


class TestAiOverview:
    def test_is_shown_when_the_row_succeeded(self):
        assert row_for([aio_row()])['ai_overview_shown'] is True

    def test_is_not_shown_when_the_results_page_had_no_overview(self):
        assert row_for([aio_row(status='no_answer')])['ai_overview_shown'] is False

    def test_is_unknown_without_an_ai_overviews_row(self):
        assert row_for([answer_row('openai', mentions_brand=True)])['ai_overview_shown'] is None

    def test_cites_you_when_a_reference_is_on_an_owned_subdomain(self):
        assert row_for([aio_row(citations=['https://help.example.com/bags'])])['ai_overview_cites_you'] is True

    def test_does_not_cite_you_when_only_competitors_are_referenced(self):
        assert row_for([aio_row(citations=['https://acme.example.org/'])])['ai_overview_cites_you'] is False

    def test_citing_is_unknown_without_owned_domains(self):
        assert row_for([aio_row(citations=['https://example.com/'])], owned=())['ai_overview_cites_you'] is None


class TestAiMentionRate:
    def test_is_the_mention_rate_kpi_over_every_answer_of_the_run(self):
        brand = {'name': 'Example Air', 'classification': 'first_party', 'rank': 2}
        run = [aio_row(brands=[brand]), answer_row('openai', mentions_brand=True), answer_row('claude', mentions_brand=True), answer_row('gemini', mentions_brand=False)]

        assert (row_for(run)['ai_mention_rate'], row_for(run)['answers']) == (75.0, 4)

    def test_leaves_out_a_no_answer_ai_overviews_row(self):
        run = [aio_row(status='no_answer'), answer_row('openai', mentions_brand=True)]

        assert (row_for(run)['ai_mention_rate'], row_for(run)['answers']) == (100.0, 1)

    def test_leaves_out_failed_engine_calls(self):
        run = [aio_row(status='no_answer'), answer_row('openai', mentions_brand=False, status='error')]

        assert (row_for(run)['ai_mention_rate'], row_for(run)['answers']) == (None, 0)


class TestCitationOverlap:
    def test_is_the_share_of_cited_urls_also_in_the_organic_top_10(self):
        aio = aio_row(citations=['https://example.com/flights'], search_results=[organic_result(2, 'https://example.com/flights/')])
        run = [aio, answer_row('openai', mentions_brand=False, citations=['https://example.org/blog?utm_source=x'])]

        assert citation_overlap(run, aio, organic_entries(aio['search_results'])) == 50.0

    def test_counts_a_url_cited_by_several_engines_once(self):
        aio = aio_row(search_results=[organic_result(1, 'https://example.com/a')])
        run = [aio, *(answer_row(engine, mentions_brand=False, citations=['https://www.example.com/a']) for engine in ('openai', 'claude'))]

        assert citation_overlap(run, aio, organic_entries(aio['search_results'])) == 100.0

    def test_is_none_when_nothing_was_cited(self):
        assert row_for([aio_row(search_results=RANKED_TOP_3), answer_row('openai', mentions_brand=True)])['citation_overlap'] is None


class TestQuadrant:
    @pytest.mark.parametrize(('position', 'rate', 'expected'), [
        (10, 50.0, 'both_strong'),
        (3, 49.9, 'ai_gap'),
        (11, 80.0, 'seo_gap'),
        (None, 50.0, 'seo_gap'),
        (None, 0.0, 'both_weak'),
    ])
    def test_splits_on_position_10_and_a_50_percent_mention_rate(self, position, rate, expected):
        assert quadrant(position, rate, has_aio=True) == expected

    def test_is_no_data_without_an_ai_overviews_row(self):
        assert row_for([answer_row('openai', mentions_brand=True)])['quadrant'] == 'no_data'

    def test_is_no_data_without_an_answer(self):
        assert row_for([aio_row(status='no_answer', search_results=RANKED_TOP_3)])['quadrant'] == 'no_data'

    def test_is_ai_gap_for_a_top_ranked_brand_the_engines_ignore(self):
        run = [aio_row(search_results=RANKED_TOP_3), answer_row('openai', mentions_brand=False)]

        assert row_for(run)['quadrant'] == 'ai_gap'


class TestRowIdentity:
    def test_carries_the_keyword_volume_and_run(self):
        row = row_for([aio_row()], volume=None)

        assert (row['keyword_id'], row['keyword'], row['search_volume'], row['last_run']) == ('kw-1', 'cheap flights', None, RUN_TS)

    def test_has_no_run_without_an_ai_overviews_row(self):
        assert row_for([])['last_run'] is None


class TestTable:
    def test_summary_counts_every_quadrant(self):
        rows = [{'quadrant': 'ai_gap'}, {'quadrant': 'ai_gap'}, {'quadrant': 'no_data'}]

        assert summarize(rows) == {'both_strong': 0, 'ai_gap': 2, 'seo_gap': 0, 'both_weak': 0, 'no_data': 1}

    def test_sorts_by_volume_descending_with_unknown_volumes_last_then_keyword(self):
        rows = [
            {'keyword': 'b', 'search_volume': None}, {'keyword': 'c', 'search_volume': 10},
            {'keyword': 'a', 'search_volume': None}, {'keyword': 'd', 'search_volume': 900},
        ]

        assert [row['keyword'] for row in sort_rows(rows)] == ['d', 'c', 'a', 'b']
