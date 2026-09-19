"""Tests for shared.visibility_score."""

from __future__ import annotations

import pytest

from shared import visibility_score


class TestCalculateVisibilityScore:
    @pytest.mark.parametrize(
        ('provider_count', 'total_mentions', 'best_rank', 'avg_sentiment', 'total_providers', 'expected'),
        [
            (4, 50, 1, 1.0, 4, 100.0),
            (2, 5, 3, 0.0, 4, 58.1),
            (1, 1, 10, -1.0, 4, 16.5),
            (3, 120, 11, 0.5, 4, 60.5),
            (4, 7, 2, 0.25, 9, 61.6),
        ],
    )
    def test_matches_the_scores_the_handlers_computed_before_consolidation(
        self, provider_count, total_mentions, best_rank, avg_sentiment, total_providers, expected
    ) -> None:
        score = visibility_score.calculate_visibility_score(
            provider_count, total_mentions, best_rank, avg_sentiment, total_providers
        )

        assert score == expected

    def test_returns_100_for_full_coverage_top_rank_saturated_mentions_and_positive_sentiment(self) -> None:
        assert visibility_score.calculate_visibility_score(4, 50, 1, 1.0, 4) == 100.0

    def test_scores_an_unmentioned_brand_at_the_rank_floor_plus_neutral_sentiment(self) -> None:
        assert visibility_score.calculate_visibility_score(0, 0, 9999, 0.0, 4) == 8.0

    def test_drops_the_provider_term_when_no_providers_are_enabled(self) -> None:
        with_providers = visibility_score.calculate_visibility_score(2, 5, 3, 0.0, 4)
        without_providers = visibility_score.calculate_visibility_score(2, 5, 3, 0.0, 0)

        assert without_providers == 38.1
        assert with_providers - without_providers == pytest.approx(20.0)

    def test_caps_the_mention_term_at_the_saturation_count(self) -> None:
        saturated = visibility_score.calculate_visibility_score(0, 50, 9999, 0.0, 4)
        beyond = visibility_score.calculate_visibility_score(0, 5000, 9999, 0.0, 4)

        assert saturated == beyond


class TestCalculateSentimentAgnosticVisibilityScore:
    @pytest.mark.parametrize(
        ('provider_count', 'total_mentions', 'best_rank', 'total_providers', 'expected'),
        [
            (4, 50, 1, 4, 90.0),
            (2, 5, 3, 4, 53.1),
            (1, 1, 10, 4, 16.5),
            (3, 120, 11, 4, 53.0),
            (2, 5, 3, 0, 33.1),
        ],
    )
    def test_matches_the_scores_historical_trends_computed_before_consolidation(
        self, provider_count, total_mentions, best_rank, total_providers, expected
    ) -> None:
        score = visibility_score.calculate_sentiment_agnostic_visibility_score(
            provider_count, total_mentions, best_rank, total_providers
        )

        assert score == expected

    def test_tops_out_at_90_because_the_sentiment_term_is_omitted(self) -> None:
        assert visibility_score.calculate_sentiment_agnostic_visibility_score(4, 50, 1, 4) == 90.0

    def test_scores_an_unmentioned_brand_at_the_rank_floor_only(self) -> None:
        assert visibility_score.calculate_sentiment_agnostic_visibility_score(0, 0, 9999, 4) == 3.0

    def test_equals_the_four_factor_score_minus_the_neutral_sentiment_term(self) -> None:
        four_factor = visibility_score.calculate_visibility_score(2, 5, 3, 0.0, 4)
        three_factor = visibility_score.calculate_sentiment_agnostic_visibility_score(2, 5, 3, 4)

        assert four_factor - three_factor == pytest.approx(5.0)


class TestSentimentToScore:
    @pytest.mark.parametrize(
        ('label', 'expected'),
        [
            ('positive', 1.0),
            ('Positive', 1.0),
            ('neutral', 0.0),
            ('negative', -1.0),
            ('mixed', 0.0),
        ],
    )
    def test_maps_known_labels_case_insensitively(self, label, expected) -> None:
        assert visibility_score.sentiment_to_score(label) == expected

    def test_treats_missing_label_as_neutral(self) -> None:
        assert visibility_score.sentiment_to_score(None) == 0.0
        assert visibility_score.sentiment_to_score('') == 0.0

    def test_treats_unknown_label_as_neutral(self) -> None:
        assert visibility_score.sentiment_to_score('weird') == 0.0


class TestNormalizeRank:
    @pytest.mark.parametrize(
        ('value', 'expected'),
        [
            (1, 1),
            ('3', 3),
            (None, None),
            (0, None),
            (-1, None),
            (1.5, None),
            (999, None),
            (float('nan'), None),
        ],
    )
    def test_returns_only_positive_integer_ranks_below_the_unranked_sentinel(self, value, expected) -> None:
        assert visibility_score.normalize_rank(value) == expected


class TestFirstPartyProminence:
    def test_uses_each_answers_best_first_party_placement(self) -> None:
        prominence = visibility_score.summarize_first_party_prominence([
            [
                {'rank': 4, 'first_position': 40},
                {'rank': 1, 'first_position': 10},
            ],
            [{'rank': 3, 'first_position': 30}],
            [{'rank': 999, 'first_position': 20}],
            [],
        ])

        assert prominence == {
            'answers': 4,
            'mentioned_answers': 3,
            'rank_1_share': 25.0,
            'top_3_share': 50.0,
            'mean_rank': 2.0,
            'mean_first_position': 20.0,
        }

    def test_returns_unavailable_means_when_mentions_have_no_valid_placement(self) -> None:
        prominence = visibility_score.summarize_first_party_prominence([
            [{'rank': 999}],
            [{'rank': None, 'first_position': float('nan')}],
            [],
        ])

        assert prominence == {
            'answers': 3,
            'mentioned_answers': 2,
            'rank_1_share': 0.0,
            'top_3_share': 0.0,
            'mean_rank': None,
            'mean_first_position': None,
        }


def _prominence(
    answers=0,
    mentioned_answers=0,
    rank_1_share=0.0,
    top_3_share=0.0,
    mean_rank=None,
    mean_first_position=None,
):
    return {
        'answers': answers,
        'mentioned_answers': mentioned_answers,
        'rank_1_share': rank_1_share,
        'top_3_share': top_3_share,
        'mean_rank': mean_rank,
        'mean_first_position': mean_first_position,
    }


def _keyword_metrics(
    first_party_score,
    competitor_score,
    first_party_sov,
    brands,
    timestamp='2026-09-18T10:00:00Z',
    prominence=None,
):
    return {
        'timestamp': timestamp,
        'total_mentions': sum(int(brand.get('total_mentions', 0)) for brand in brands),
        'brands': brands,
        'first_party': [brand for brand in brands if brand['classification'] == 'first_party'],
        'prominence': prominence or _prominence(),
        'summary': {
            'first_party_avg_score': first_party_score,
            'competitor_avg_score': competitor_score,
            'first_party_total_sov': first_party_sov,
            'competitor_total_sov': 100 - first_party_sov,
        },
    }


def _brand(name, classification, score, sov=10.0, providers=('openai',), mentions=1, rank=1):
    return {
        'name': name,
        'classification': classification,
        'visibility_score': score,
        'share_of_voice': sov,
        'providers': list(providers),
        'provider_count': len(providers),
        'total_mentions': mentions,
        'best_rank': rank,
    }


class TestShareOfVoice:
    def test_splits_mentions_into_percentages(self) -> None:
        assert visibility_score.calculate_share_of_voice({'a': 3, 'b': 1}, 4) == {'a': 75.0, 'b': 25.0}

    def test_is_empty_when_nothing_was_mentioned(self) -> None:
        assert visibility_score.calculate_share_of_voice({'a': 0}, 0) == {}


class TestMean:
    def test_averages_values(self) -> None:
        assert visibility_score.mean([1, 2, 3]) == 2.0

    def test_is_zero_for_no_values(self) -> None:
        assert visibility_score.mean([]) == 0.0


class TestGroupSummary:
    def test_averages_only_keywords_that_have_data(self) -> None:
        per_keyword = [
            _keyword_metrics(80.0, 40.0, 60.0, [_brand('Mine', 'first_party', 80.0, providers=('openai', 'gemini'))]),
            {'error': 'No data found for keyword'},
            _keyword_metrics(40.0, 20.0, 20.0, [_brand('Mine', 'first_party', 40.0, providers=('openai',))]),
        ]

        summary = visibility_score.summarize_group_visibility(['a', 'b', 'c'], per_keyword, total_providers=4)

        assert (summary['keywords_analyzed'], summary['keywords_with_data']) == (3, 2)
        assert summary['summary']['first_party_avg_score'] == 60.0
        assert summary['summary']['competitor_avg_score'] == 30.0
        assert summary['summary']['first_party_avg_sov'] == 40.0

    def test_coverage_is_the_share_of_keywords_where_the_brand_appears(self) -> None:
        per_keyword = [
            _keyword_metrics(80.0, 40.0, 60.0, [_brand('Mine', 'first_party', 80.0)]),
            _keyword_metrics(0.0, 50.0, 0.0, [_brand('Rival', 'competitor', 50.0)]),
        ]

        summary = visibility_score.summarize_group_visibility(['a', 'b'], per_keyword, total_providers=4)

        assert summary['summary']['coverage_rate'] == 50.0

    def test_provider_coverage_averages_first_party_engine_share(self) -> None:
        per_keyword = [
            _keyword_metrics(
                80.0,
                0.0,
                100.0,
                [_brand('Mine', 'first_party', 80.0, providers=('openai', 'gemini', 'perplexity', 'claude'))],
            ),
            _keyword_metrics(20.0, 0.0, 100.0, [_brand('Mine', 'first_party', 20.0, providers=('openai',))]),
        ]

        summary = visibility_score.summarize_group_visibility(['a', 'b'], per_keyword, total_providers=4)

        assert summary['summary']['provider_coverage'] == 62.5

    def test_per_keyword_rows_keep_their_order_and_flag_missing_data(self) -> None:
        per_keyword = [{'error': 'x'}, _keyword_metrics(30.0, 10.0, 25.0, [_brand('Mine', 'first_party', 30.0)])]

        rows = visibility_score.summarize_group_visibility(['first', 'second'], per_keyword, total_providers=3)['keywords']

        assert [row['keyword'] for row in rows] == ['first', 'second']
        assert (rows[0]['has_data'], rows[1]['has_data']) == (False, True)
        assert (rows[1]['first_party_score'], rows[1]['first_party_sov'], rows[1]['first_party_mentioned']) == (30.0, 25.0, True)

    def test_per_keyword_rows_carry_answer_level_prominence(self) -> None:
        metrics = _keyword_metrics(
            30.0,
            10.0,
            25.0,
            [_brand('Mine', 'first_party', 30.0, rank=2)],
            prominence=_prominence(4, 3, 25.0, 50.0, 2.5, 18.0),
        )

        row = visibility_score.summarize_group_visibility(['keyword'], [metrics], total_providers=3)['keywords'][0]

        assert {
            key: row[key]
            for key in (
                'first_party_best_rank',
                'answers',
                'mentioned_answers',
                'rank_1_share',
                'top_3_share',
                'mean_rank',
                'mean_first_position',
            )
        } == {
            'first_party_best_rank': 2,
            'answers': 4,
            'mentioned_answers': 3,
            'rank_1_share': 25.0,
            'top_3_share': 50.0,
            'mean_rank': 2.5,
            'mean_first_position': 18.0,
        }

    def test_prominence_averages_only_meaningful_keyword_values(self) -> None:
        per_keyword = [
            _keyword_metrics(
                80.0,
                0.0,
                100.0,
                [_brand('Mine', 'first_party', 80.0, rank=1)],
                prominence=_prominence(4, 3, 25.0, 50.0, 2.0, 10.0),
            ),
            {'error': 'No data found for keyword'},
            _keyword_metrics(
                40.0,
                0.0,
                100.0,
                [_brand('Mine', 'first_party', 40.0, rank=2)],
                prominence=_prominence(2, 2, 0.0, 100.0, 3.0, 30.0),
            ),
            _keyword_metrics(
                0.0,
                0.0,
                0.0,
                [],
                prominence=_prominence(0, 0, 100.0, 100.0, None, None),
            ),
        ]

        group = visibility_score.summarize_group_visibility(['a', 'b', 'c', 'd'], per_keyword, total_providers=4)

        assert {
            key: group['summary'][key]
            for key in (
                'first_party_mean_best_rank',
                'rank_1_share',
                'top_3_share',
                'mean_rank',
                'mean_first_position',
            )
        } == {
            'first_party_mean_best_rank': 1.5,
            'rank_1_share': 12.5,
            'top_3_share': 75.0,
            'mean_rank': 2.5,
            'mean_first_position': 20.0,
        }

    def test_unranked_sentinel_is_unavailable_in_group_rank_fields(self) -> None:
        metrics = _keyword_metrics(
            20.0,
            0.0,
            100.0,
            [_brand('Mine', 'first_party', 20.0, rank=999)],
            prominence=_prominence(1, 1, 0.0, 0.0, 999, None),
        )

        group = visibility_score.summarize_group_visibility(['a'], [metrics], total_providers=4)

        assert group['keywords'][0]['first_party_best_rank'] is None
        assert group['keywords'][0]['mean_rank'] is None
        assert group['summary']['first_party_mean_best_rank'] is None
        assert group['brands'][0]['best_rank'] is None

    def test_reports_the_latest_timestamp_across_keywords(self) -> None:
        per_keyword = [
            _keyword_metrics(1.0, 1.0, 1.0, [], timestamp='2026-09-01T00:00:00Z'),
            _keyword_metrics(1.0, 1.0, 1.0, [], timestamp='2026-09-18T00:00:00Z'),
        ]

        summary = visibility_score.summarize_group_visibility(['a', 'b'], per_keyword, total_providers=3)

        assert summary['timestamp'] == '2026-09-18T00:00:00Z'

    def test_is_all_zero_or_unavailable_when_no_keyword_has_data(self) -> None:
        summary = visibility_score.summarize_group_visibility(['a'], [{'error': 'x'}], total_providers=3)

        assert summary['summary'] == {
            'first_party_avg_score': 0.0,
            'competitor_avg_score': 0.0,
            'first_party_avg_sov': 0.0,
            'competitor_avg_sov': 0.0,
            'coverage_rate': 0.0,
            'provider_coverage': 0.0,
            'first_party_mean_best_rank': None,
            'rank_1_share': 0.0,
            'top_3_share': 0.0,
            'mean_rank': None,
            'mean_first_position': None,
        }
        assert summary['brands'] == []


class TestBrandsAcrossKeywords:
    def test_averages_a_brands_score_over_the_keywords_it_appears_on(self) -> None:
        per_keyword = [
            _keyword_metrics(0, 0, 0, [_brand('Rival', 'competitor', 90.0, providers=('openai',), mentions=2, rank=1)]),
            _keyword_metrics(0, 0, 0, [_brand('Rival', 'competitor', 50.0, providers=('gemini',), mentions=1, rank=3)]),
            _keyword_metrics(0, 0, 0, [_brand('Other', 'other', 60.0)]),
        ]

        brands = visibility_score.aggregate_brands_across_keywords(per_keyword)

        rival = next(brand for brand in brands if brand['name'] == 'Rival')
        assert rival['visibility_score'] == 70.0
        assert rival['keyword_count'] == 2
        assert rival['providers'] == ['gemini', 'openai']
        assert (rival['total_mentions'], rival['best_rank']) == (3, 1)

    def test_ranks_by_score_then_breadth(self) -> None:
        per_keyword = [
            _keyword_metrics(0, 0, 0, [_brand('Wide', 'competitor', 70.0), _brand('Narrow', 'competitor', 70.0)]),
            _keyword_metrics(0, 0, 0, [_brand('Wide', 'competitor', 70.0), _brand('Top', 'competitor', 95.0)]),
        ]

        brands = visibility_score.aggregate_brands_across_keywords(per_keyword)

        assert [brand['name'] for brand in brands] == ['Top', 'Wide', 'Narrow']

    def test_merges_names_case_insensitively(self) -> None:
        per_keyword = [
            _keyword_metrics(0, 0, 0, [_brand('Hotel X', 'first_party', 10.0)]),
            _keyword_metrics(0, 0, 0, [_brand('hotel x', 'first_party', 30.0)]),
        ]

        brands = visibility_score.aggregate_brands_across_keywords(per_keyword)

        assert [(brand['name'], brand['visibility_score'], brand['keyword_count']) for brand in brands] == [
            ('Hotel X', 20.0, 2)
        ]
