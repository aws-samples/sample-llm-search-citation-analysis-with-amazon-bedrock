"""Tests for shared/kpi_tally.py: KPIs from summed run tallies equal the KPIs of the answers themselves."""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from shared.kpi_engine import answers_from_rows, brand_kpis, brand_table
from shared.kpi_tally import (
    RunTally,
    brands_truncated,
    run_tallies,
    run_tally,
    tally_brand_table,
    tally_kpis,
    tally_mentions,
    tally_models,
)
from testing.kpi_row_strategies import KEYWORDS, OWNED_DOMAINS, search_rows

PROPERTY_SETTINGS = settings(max_examples=200, deadline=None)


def _tallies(rows, owned):
    answers = answers_from_rows(rows)
    return [tally for keyword in KEYWORDS for tally in run_tallies(keyword, [a for a in answers if a.keyword == keyword], owned)]


class TestPooledKpisEqualTheAnswers:
    @PROPERTY_SETTINGS
    @given(rows=search_rows(), owned=OWNED_DOMAINS)
    def test_every_brand_kpi_of_summed_run_tallies_equals_brand_kpis_of_the_answers(self, rows, owned):
        assert tally_kpis(_tallies(rows, owned), owned) == brand_kpis(answers_from_rows(rows), owned)

    @PROPERTY_SETTINGS
    @given(rows=search_rows(), owned=OWNED_DOMAINS)
    def test_pooled_kpis_keep_brand_kpis_key_order(self, rows, owned):
        assert list(tally_kpis(_tallies(rows, owned), owned)) == list(brand_kpis(answers_from_rows(rows), owned))

    @PROPERTY_SETTINGS
    @given(rows=search_rows(), owned=OWNED_DOMAINS, split=st.integers(min_value=0, max_value=40))
    def test_kpis_of_two_partial_pools_added_up_equal_one_pool(self, rows, owned, split):
        tallies = _tallies(rows, owned)

        assert tally_kpis(tallies[:split] + tallies[split:], owned) == tally_kpis(tallies, owned)

    @PROPERTY_SETTINGS
    @given(rows=search_rows(), owned=OWNED_DOMAINS)
    def test_each_run_tally_alone_equals_brand_kpis_of_its_run(self, rows, owned):
        answers = answers_from_rows(rows)

        assert [tally_kpis([tally], owned) for tally in _tallies(rows, owned)] == [
            brand_kpis([a for a in answers if (a.keyword, a.timestamp) == (tally.keyword, tally.timestamp)], owned)
            for tally in _tallies(rows, owned)
        ]


class TestPooledBrandTableEqualsTheAnswers:
    @PROPERTY_SETTINGS
    @given(rows=search_rows(), owned=OWNED_DOMAINS)
    def test_brand_table_of_summed_run_tallies_equals_brand_table_of_the_answers(self, rows, owned):
        assert tally_brand_table(_tallies(rows, owned)) == brand_table(answers_from_rows(rows))

    @PROPERTY_SETTINGS
    @given(rows=search_rows())
    def test_models_of_summed_run_tallies_list_each_engines_models_of_the_answers(self, rows):
        answers = answers_from_rows(rows)
        expected = {
            provider: sorted({answer.model for answer in answers if answer.provider == provider and answer.model})
            for provider in sorted({answer.provider for answer in answers if answer.model})
        }

        assert tally_models(_tallies(rows, ())) == expected

    @PROPERTY_SETTINGS
    @given(rows=search_rows())
    def test_brand_sightings_counted_equal_every_sighting_of_the_answers(self, rows):
        assert tally_mentions(_tallies(rows, ())) == sum(len(answer.sightings) for answer in answers_from_rows(rows))


class TestEmptyPool:
    def test_kpis_of_no_tally_equal_brand_kpis_of_no_answer(self):
        assert tally_kpis([], ['hotel-sol.com']) == brand_kpis([], ['hotel-sol.com'])

    def test_brand_table_of_no_tally_is_empty(self):
        assert tally_brand_table([]) == []


class TestBrandCap:
    ROWS = [
        {
            'keyword': 'k', 'provider': 'openai', 'timestamp': '2026-09-01T06:00:00Z', 'status': 'success',
            'brands': [
                {'name': 'Hotel Sol', 'classification': 'first_party', 'rank': 9},
                {'name': 'Parador', 'classification': 'competitor', 'rank': 1},
                {'name': 'Meliá', 'classification': 'competitor', 'rank': 2},
                {'name': 'NH', 'classification': 'competitor', 'rank': 3},
            ],
        },
    ]

    def test_keeps_first_party_tracked_and_most_visible_brands_in_first_named_order(self):
        tally = run_tally('k', '2026-09-01T06:00:00Z', answers_from_rows(self.ROWS), brand_cap=3, tracked_brands=['nh'])

        assert [brand.name for brand in tally.brands] == ['Hotel Sol', 'Parador', 'NH']

    def test_counts_every_brand_named_when_the_cap_drops_some(self):
        tally = run_tally('k', '2026-09-01T06:00:00Z', answers_from_rows(self.ROWS), brand_cap=2)

        assert (tally.brands_total, len(tally.brands)) == (4, 2)

    def test_share_of_voice_of_a_kept_brand_counts_the_dropped_brands_mentions(self):
        tally = run_tally('k', '2026-09-01T06:00:00Z', answers_from_rows(self.ROWS), brand_cap=1)

        assert tally_brand_table([tally])[0]['share_of_voice'] == 25.0

    def test_says_a_capped_run_cut_its_brands_and_an_uncapped_one_did_not(self):
        capped = run_tally('k', '2026-09-01T06:00:00Z', answers_from_rows(self.ROWS), brand_cap=2)
        whole = run_tally('k', '2026-09-01T06:00:00Z', answers_from_rows(self.ROWS))

        assert (brands_truncated([whole, capped]), brands_truncated([whole])) == (True, False)

    def test_caps_every_run_of_raw_answers_like_a_stored_row(self):
        tallies = run_tallies('k', answers_from_rows(self.ROWS), brand_cap=3, tracked_brands=['nh'])

        assert [[brand.name for brand in tally.brands] for tally in tallies] == [['Hotel Sol', 'Parador', 'NH']]


class TestOwnedFingerprint:
    def test_a_tally_answers_for_the_owned_domains_it_was_counted_against(self):
        tally = run_tally('k', 't', [], ['www.Hotel-Sol.com'])

        assert tally.matches_owned(RunTally('k', 't', {}, owned=tally.owned).owned) is True

    def test_a_tally_counted_against_other_owned_domains_does_not_answer_for_them(self):
        tally = run_tally('k', 't', [], ['hotel-sol.com'])

        assert tally.matches_owned(run_tally('k', 't', [], ['hotel-mar.com']).owned) is False

    def test_any_tally_answers_when_no_owned_domain_is_configured(self):
        assert run_tally('k', 't', [], ['hotel-sol.com']).matches_owned('') is True
