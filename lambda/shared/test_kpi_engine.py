"""Tests for shared/kpi_engine.py — the market-aligned KPIs every page reports."""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from typing import Any

import pytest

from shared.kpi_engine import (
    KPI_IDS,
    PERCENT_KPIS,
    answer_from_row,
    answers_from_rows,
    brand_kpis,
    brand_table,
    is_owned_domain,
    kpi_changes,
    normalize_domain,
    position_weight,
    trend_direction,
)

RUN = '2026-09-01T06:00:00.000000Z'
HOTEL = 'Hotel Sol'
RIVAL = 'Hotel Mar'
OWNED = ['hotel-sol.com']


def _brand(name: str, classification: str, rank: Any = None, sentiment: str | None = None) -> dict[str, Any]:
    return {'name': name, 'classification': classification, 'rank': rank, 'sentiment': sentiment, 'mention_count': 5}


def _row(keyword: str, provider: str, *brands: dict[str, Any], citations: list[str] | None = None, **extra: Any) -> dict[str, Any]:
    """A SearchResults row of one LLM answer."""
    return {
        'keyword': keyword,
        'timestamp': RUN,
        'provider': provider,
        'status': 'success',
        'query_prompt_id': 'default',
        'brands': list(brands),
        'citations': citations or [],
        'metadata': {'model': 'gpt-5-mini'},
        **extra,
    }


# Four answers over three keywords and four engines, plus two rows that are not answers:
#   1. k1/openai     — hotel 1st (positive), rival 2nd; cites the hotel's site and booking.com
#   2. k1/gemini     — rival 1st, hotel 3rd (negative); cites booking.com
#   3. k3/claude     — rival only
#   4. k2/perplexity — hotel, position unknown (neutral); cites a hotel subdomain and tripadvisor.com
POOL_ROWS = [
    _row('k1', 'openai', _brand(HOTEL, 'first_party', 1, 'positive'), _brand(RIVAL, 'competitor', 2),
         citations=['https://www.hotel-sol.com/rooms', 'https://booking.com/a']),
    _row('k1', 'gemini', _brand(RIVAL, 'competitor', 1), _brand(HOTEL, 'first_party', 3, 'negative'),
         citations=['https://booking.com/b']),
    _row('k3', 'claude', _brand(RIVAL, 'competitor', 1)),
    _row('k2', 'perplexity', _brand(HOTEL, 'first_party', 999, 'neutral'),
         citations=['https://blog.hotel-sol.com/post', 'https://tripadvisor.com/x']),
    # A web-search provider row and a failed call: neither is an answer.
    _row('k1', 'brave', _brand(HOTEL, 'first_party', 1)),
    _row('k1', 'openai', _brand(HOTEL, 'first_party', 1), status='error'),
]
POOL = answers_from_rows(POOL_ROWS)
# 0.9 ** 9: the weight of a mention whose position is unknown (10th-position weight).
UNKNOWN_WEIGHT = 0.387420489


class TestAnswerFromRow:
    def test_keeps_only_successful_llm_answers(self):
        assert [(answer.keyword, answer.provider) for answer in POOL] == [
            ('k1', 'openai'), ('k1', 'gemini'), ('k3', 'claude'), ('k2', 'perplexity'),
        ]

    @pytest.mark.parametrize(('provider', 'is_answer'), [('openai', True), ('claude', True), ('brave', False), ('tavily', False)])
    def test_counts_only_the_rows_of_ai_engines_as_answers(self, provider, is_answer):
        assert (answer_from_row(_row('k', provider)) is not None) is is_answer

    def test_counts_a_row_without_status_as_an_answer(self):
        row = _row('k', 'openai')
        del row['status']

        assert answer_from_row(row) is not None

    @pytest.mark.parametrize('status', ['error', 'timeout', ''])
    def test_excludes_rows_whose_status_is_not_success(self, status):
        assert answer_from_row(_row('k', 'openai', status=status)) is None

    @pytest.mark.parametrize(('first', 'second', 'expected'), [
        (4, 2, ('hotel sol', 2)),
        (2, 4, ('Hotel Sol', 2)),
        (None, 5, ('hotel sol', 5)),
        (5, None, ('Hotel Sol', 5)),
        (3, 3, ('Hotel Sol', 3)),
    ])
    def test_counts_a_brand_named_twice_once_at_its_best_known_position(self, first, second, expected):
        answer = answer_from_row(_row('k', 'openai', _brand(HOTEL, 'first_party', first), _brand('hotel sol', 'first_party', second)))

        assert answer is not None
        assert [(sighting.name, sighting.rank) for sighting in answer.sightings] == [expected]

    @pytest.mark.parametrize(('target', 'attribute'), [(POOL[0], 'keyword'), (POOL[0].sightings[0], 'rank')])
    def test_is_immutable(self, target, attribute):
        with pytest.raises(FrozenInstanceError):
            setattr(target, attribute, None)

    @pytest.mark.parametrize(('rank', 'expected'), [
        (1, 1), ('3', 3), (998, 998), (999, None), (0, None), (-2, None), (None, None), ('first', None), (True, None),
    ])
    def test_reads_positions_and_treats_invalid_or_sentinel_ranks_as_unknown(self, rank, expected):
        answer = answer_from_row(_row('k', 'openai', _brand(HOTEL, 'first_party', rank)))

        assert answer is not None
        assert answer.sightings[0].rank == expected

    def test_skips_brands_without_a_name_and_malformed_entries(self):
        row = _row('k', 'openai', _brand('  ', 'competitor'), _brand(RIVAL, 'competitor'), {'classification': 'competitor', 'rank': 1})
        row['brands'].append('not a brand')

        answer = answer_from_row(row)

        assert answer is not None
        assert [sighting.name for sighting in answer.sightings] == [RIVAL]

    @pytest.mark.parametrize(('classification', 'expected'), [
        ('first_party', 'first_party'), ('competitor', 'competitor'), ('other', 'other'), ('partner', 'other'), (None, 'other'),
    ])
    def test_maps_unknown_classifications_to_other(self, classification, expected):
        answer = answer_from_row(_row('k', 'openai', _brand(RIVAL, classification)))

        assert answer is not None
        assert answer.sightings[0].classification == expected

    @pytest.mark.parametrize(('sentiment', 'expected'), [('Positive', 'positive'), ('mixed', 'mixed'), ('great', None), (None, None)])
    def test_normalizes_sentiment_labels(self, sentiment, expected):
        answer = answer_from_row(_row('k', 'openai', _brand(RIVAL, 'competitor', 1, sentiment)))

        assert answer is not None
        assert answer.sightings[0].sentiment == expected

    def test_reads_the_cited_domains_once_each(self):
        answer = answer_from_row(_row('k', 'openai', citations=['https://www.a.com/1', 'http://a.com/2', 'b.org', '', 'https://']))

        assert answer is not None
        assert answer.cited_domains == frozenset({'a.com', 'b.org'})

    def test_reads_the_identity_of_the_answer(self):
        answer = answer_from_row(_row('k', 'gemini', query_prompt_id='family'))

        assert answer is not None
        assert (answer.keyword, answer.provider, answer.persona, answer.timestamp, answer.model) == (
            'k', 'gemini', 'family', RUN, 'gpt-5-mini',
        )

    def test_defaults_the_persona_and_model_when_missing(self):
        row = _row('k', 'openai', metadata={})
        del row['query_prompt_id']

        answer = answer_from_row(row)

        assert answer is not None
        assert (answer.persona, answer.model) == ('default', None)

    def test_defaults_a_missing_keyword_and_timestamp_to_empty(self):
        row = _row('k', 'openai')
        del row['keyword'], row['timestamp']

        answer = answer_from_row(row)

        assert answer is not None
        assert (answer.keyword, answer.timestamp) == ('', '')

    @pytest.mark.parametrize(('metadata', 'expected'), [
        ({'model': 'sonar'}, 'sonar'), ({'model': ''}, None), ({'model': 42}, None), ('gpt-5', None), (None, None),
    ])
    def test_reads_the_model_only_from_a_non_empty_metadata_string(self, metadata, expected):
        answer = answer_from_row(_row('k', 'openai', metadata=metadata))

        assert answer is not None
        assert answer.model == expected


class TestDomains:
    @pytest.mark.parametrize(('value', 'expected'), [
        ('https://www.Hotel-Sol.com/rooms?x=1', 'hotel-sol.com'),
        ('hotel-sol.com', 'hotel-sol.com'),
        ('www.hotel-sol.com:8443/path', 'hotel-sol.com'),
        ('  blog.hotel-sol.com  ', 'blog.hotel-sol.com'),
        ('https://hotel-sol.com./', 'hotel-sol.com'),
        ('', None),
        ('   ', None),
        (None, None),
        (42, None),
    ])
    def test_normalizes_urls_and_domains_to_their_host(self, value, expected):
        assert normalize_domain(value) == expected

    @pytest.mark.parametrize(('domain', 'expected'), [
        ('hotel-sol.com', True),
        ('blog.hotel-sol.com', True),
        ('nothotel-sol.com', False),
        ('hotel-sol.com.evil.net', False),
        ('booking.com', False),
    ])
    def test_owns_a_domain_and_its_subdomains_only(self, domain, expected):
        assert is_owned_domain(domain, ['https://www.hotel-sol.com/']) is expected

    def test_owns_nothing_without_owned_domains(self):
        assert is_owned_domain('hotel-sol.com', ['', '  ']) is False


class TestPositionWeight:
    @pytest.mark.parametrize(('rank', 'expected'), [(1, 1.0), (2, 0.9), (3, 0.81), (10, UNKNOWN_WEIGHT), (25, UNKNOWN_WEIGHT), (None, UNKNOWN_WEIGHT)])
    def test_decays_by_ten_percent_per_position_down_to_the_tenth(self, rank, expected):
        assert position_weight(rank) == pytest.approx(expected)


class TestBrandKpis:
    @pytest.mark.parametrize(('kpi', 'expected'), [
        ('answers', 4),
        ('mentions', 3),
        ('mention_rate', 75.0),
        # 3 hotel sightings of 6 brand sightings.
        ('share_of_voice', 50.0),
        # Ranked mentions only: (1 + 3) / 2.
        ('average_position', 2.0),
        ('top_1_share', 25.0),
        ('top_3_share', 50.0),
        # (1 + 0.81 + 0.9^9) / 4 answers.
        ('visibility_score', 54.9),
        ('citations', 2),
        ('citation_rate', 50.0),
        # 2 owned domains of 5 cited (answer, domain) pairs.
        ('citation_share', 40.0),
        # (1 positive - 1 negative) / 3 labelled.
        ('net_sentiment', 0.0),
        ('engine_coverage', 75.0),
        ('keyword_coverage', 66.7),
        ('engines', 4),
        ('keywords', 3),
    ])
    def test_computes_each_kpi_of_the_tracked_brand(self, kpi, expected):
        assert brand_kpis(POOL, OWNED)[kpi] == expected

    def test_reports_every_kpi_id(self):
        assert set(KPI_IDS) <= set(brand_kpis(POOL, OWNED))

    def test_splits_the_sentiment_of_the_brand_mentions(self):
        assert brand_kpis(POOL, OWNED)['sentiment_split'] == {'positive': 1, 'neutral': 1, 'negative': 1, 'mixed': 0}

    def test_leaves_the_citation_kpis_empty_without_owned_domains(self):
        kpis = brand_kpis(POOL, ['', '  '])

        assert (kpis['citations'], kpis['citation_rate'], kpis['citation_share']) == (None, None, None)

    def test_leaves_citation_share_empty_when_answers_cite_nothing(self):
        kpis = brand_kpis(answers_from_rows([_row('k', 'openai')]), OWNED)

        assert (kpis['citations'], kpis['citation_rate'], kpis['citation_share']) == (0, 0.0, None)

    def test_leaves_every_rate_empty_for_an_empty_pool(self):
        kpis = brand_kpis([], OWNED)

        assert {kpi: kpis[kpi] for kpi in PERCENT_KPIS | {'average_position', 'net_sentiment'}} == dict.fromkeys(
            PERCENT_KPIS | {'average_position', 'net_sentiment'},
        )
        assert (kpis['answers'], kpis['mentions'], kpis['citations']) == (0, 0, 0)

    def test_scores_zero_when_answers_never_name_the_brand(self):
        kpis = brand_kpis(answers_from_rows([_row('k', 'openai', _brand(RIVAL, 'competitor', 1))]), OWNED)

        assert (kpis['mention_rate'], kpis['visibility_score'], kpis['share_of_voice'], kpis['average_position']) == (0.0, 0.0, 0.0, None)

    def test_counts_mixed_sentiment_as_labelled_but_neither_positive_nor_negative(self):
        rows = [
            _row('k', 'openai', _brand(HOTEL, 'first_party', 1, 'positive')),
            _row('k', 'claude', _brand(HOTEL, 'first_party', 1, 'positive')),
            _row('k', 'gemini', _brand(HOTEL, 'first_party', 1, 'mixed')),
        ]

        assert brand_kpis(answers_from_rows(rows))['net_sentiment'] == 66.7

    def test_leaves_net_sentiment_empty_when_no_mention_is_labelled(self):
        rows = [_row('k', 'openai', _brand(HOTEL, 'first_party', 1))]

        assert brand_kpis(answers_from_rows(rows))['net_sentiment'] is None

    def test_uses_the_best_position_of_several_first_party_brands_in_one_answer(self):
        rows = [_row('k', 'openai', _brand(RIVAL, 'competitor', 1), _brand(HOTEL, 'first_party', 3), _brand('Sol Spa', 'first_party', 2))]

        kpis = brand_kpis(answers_from_rows(rows))

        assert (kpis['mentions'], kpis['average_position'], kpis['visibility_score'], kpis['share_of_voice']) == (1, 2.0, 90.0, 66.7)

    def test_accepts_a_generator_of_answers(self):
        assert brand_kpis(answer for answer in POOL)['answers'] == 4

    @pytest.mark.parametrize(('kpi', 'expected'), [
        # Ranks 1, 1, 2, 4 and 9 of six answers (one answer never names the brand).
        ('average_position', 3.4),
        ('top_1_share', 33.3),
        ('top_3_share', 50.0),
    ])
    def test_measures_position_over_ranked_mentions_and_shares_over_all_answers(self, kpi, expected):
        rows = [_row('k', 'openai', _brand(HOTEL, 'first_party', rank)) for rank in (1, 1, 2, 4, 9)]
        rows.append(_row('k', 'openai', _brand(RIVAL, 'competitor', 1)))

        assert brand_kpis(answers_from_rows(rows))[kpi] == expected

    def test_rounds_the_average_position_to_hundredths(self):
        rows = [_row('k', 'openai', _brand(HOTEL, 'first_party', rank)) for rank in (1, 1, 2)]

        assert brand_kpis(answers_from_rows(rows))['average_position'] == 1.33


class TestBrandTable:
    def test_ranks_brands_by_visibility_score(self):
        assert [row['name'] for row in brand_table(POOL)] == [RIVAL, HOTEL]

    def test_applies_the_brand_kpi_formulas_to_each_brand(self):
        rival = brand_table(POOL)[0]

        assert rival == {
            'name': RIVAL,
            'classification': 'competitor',
            'mentions': 3,
            'mention_rate': 75.0,
            'share_of_voice': 50.0,
            'average_position': 1.33,
            'best_position': 1,
            'visibility_score': 72.5,
            'engines': ['claude', 'gemini', 'openai'],
            'keywords': 2,
            'net_sentiment': None,
            'sentiment_split': {'positive': 0, 'neutral': 0, 'negative': 0, 'mixed': 0},
        }

    def test_agrees_with_the_tracked_brand_kpis_for_a_single_first_party_brand(self):
        hotel = brand_table(POOL)[1]
        kpis = brand_kpis(POOL)

        assert {key: hotel[key] for key in ('mentions', 'mention_rate', 'share_of_voice', 'average_position', 'visibility_score', 'net_sentiment')} == {
            key: kpis[key] for key in ('mentions', 'mention_rate', 'share_of_voice', 'average_position', 'visibility_score', 'net_sentiment')
        }

    def test_breaks_score_ties_by_mentions_then_name(self):
        # 20 answers: every brand scores 5.0 — "Yak" from two low positions (0.9^6 + 0.9^7 ≈ 1.01).
        rows = [
            _row('k', 'openai', _brand('Zed', 'competitor', 1)),
            _row('k', 'gemini', _brand('Yak', 'competitor', 7)),
            _row('k', 'claude', _brand('Yak', 'competitor', 8)),
            _row('k', 'perplexity', _brand('beta', 'competitor', 1)),
            _row('k', 'openai', _brand('Alpha', 'competitor', 1)),
            *(_row('k', 'openai') for _ in range(15)),
        ]

        table = brand_table(answers_from_rows(rows))

        assert [(row['name'], row['visibility_score']) for row in table] == [
            ('Yak', 5.0), ('Alpha', 5.0), ('beta', 5.0), ('Zed', 5.0),
        ]

    def test_reports_no_position_for_a_brand_never_ranked(self):
        row = brand_table(answers_from_rows([_row('k', 'openai', _brand(RIVAL, 'competitor'))]))[0]

        assert (row['average_position'], row['best_position'], row['visibility_score']) == (None, None, 38.7)

    def test_is_empty_for_an_empty_pool(self):
        assert brand_table([]) == []


class TestChanges:
    def test_subtracts_the_previous_value_of_every_kpi(self):
        changes = kpi_changes({'mention_rate': 60.0, 'average_position': 2.25, 'answers': 8}, {'mention_rate': 45.5, 'average_position': 3.0, 'answers': 8})

        assert (changes['mention_rate'], changes['average_position'], changes['answers']) == (14.5, -0.75, 0)

    def test_has_no_change_when_either_side_is_missing(self):
        changes = kpi_changes({'mention_rate': 60.0, 'citation_rate': None}, {'citation_rate': 10.0})

        assert (changes['mention_rate'], changes['citation_rate'], changes['share_of_voice']) == (None, None, None)

    def test_reports_a_change_for_every_kpi_id(self):
        assert set(kpi_changes({}, {})) == set(KPI_IDS)

    def test_rounds_changes_to_hundredths(self):
        assert kpi_changes({'average_position': 2.333}, {'average_position': 1})['average_position'] == 1.33

    @pytest.mark.parametrize(('change', 'kpi', 'expected'), [
        (2.0, 'mention_rate', 'improving'),
        (1.9, 'mention_rate', 'stable'),
        (-1.9, 'mention_rate', 'stable'),
        (-2.0, 'mention_rate', 'declining'),
        (5.0, 'visibility_score', 'improving'),
        (-0.5, 'average_position', 'improving'),
        (-0.4, 'average_position', 'stable'),
        (0.4, 'average_position', 'stable'),
        (0.5, 'average_position', 'declining'),
        (None, 'mention_rate', 'stable'),
        (0.0, 'mention_rate', 'stable'),
    ])
    def test_calls_the_trend_with_a_noise_band_and_lower_is_better_for_position(self, change, kpi, expected):
        assert trend_direction(change, kpi) == expected
