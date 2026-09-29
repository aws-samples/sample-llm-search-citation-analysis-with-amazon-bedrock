"""Tests for shared/visibility_views.py — the Visibility tab's current and over-time views."""

from __future__ import annotations

from typing import Any

import pytest

from shared.kpi_engine import TRENDED_KPIS, Answer, answers_from_rows
from shared.visibility_views import PERIODS, period_key, trend_view, visibility_view

HOTEL = 'Hotel Sol'
RIVAL = 'Hotel Mar'
DAY_1 = '2026-09-01T06:00:00.000000Z'
DAY_1_LATER = '2026-09-01T18:00:00.000000Z'
DAY_2 = '2026-09-08T06:00:00.000000Z'


def _answer(keyword: str, timestamp: str, *brands: tuple[str, str, int], provider: str = 'openai', persona: str = 'default') -> Answer:
    rows = answers_from_rows([{
        'keyword': keyword,
        'timestamp': timestamp,
        'provider': provider,
        'query_prompt_id': persona,
        'brands': [{'name': name, 'classification': classification, 'rank': rank} for name, classification, rank in brands],
        'citations': ['https://hotel-sol.com/'] if any(name == HOTEL for name, _classification, _rank in brands) else [],
    }])
    return rows[0]


def _hotel_first(keyword: str, timestamp: str, **kwargs: Any) -> Answer:
    return _answer(keyword, timestamp, (HOTEL, 'first_party', 1), (RIVAL, 'competitor', 2), **kwargs)


def _rival_only(keyword: str, timestamp: str, **kwargs: Any) -> Answer:
    return _answer(keyword, timestamp, (RIVAL, 'competitor', 1), **kwargs)


class TestVisibilityView:
    ANSWERS = {
        'spa': [_hotel_first('spa', DAY_2), _rival_only('spa', DAY_2, provider='gemini')],
        'beach': [_rival_only('beach', DAY_1)],
        'golf': [],
    }

    def test_pools_every_keywords_answers(self):
        kpis = visibility_view(['spa', 'beach', 'golf'], self.ANSWERS)['kpis']

        assert (kpis['answers'], kpis['mention_rate'], kpis['keyword_coverage'], kpis['keywords']) == (3, 33.3, 50.0, 2)

    def test_measures_citations_against_the_owned_domains(self):
        assert visibility_view(['spa', 'beach'], self.ANSWERS, ['hotel-sol.com'])['kpis']['citation_rate'] == 33.3

    def test_reports_each_keyword_with_its_own_kpis(self):
        rows = visibility_view(['spa', 'beach', 'golf'], self.ANSWERS)['keywords']

        assert [(row['keyword'], row['timestamp'], row['has_data'], row['kpis'] and row['kpis']['mention_rate']) for row in rows] == [
            ('spa', DAY_2, True, 50.0), ('beach', DAY_1, True, 0.0), ('golf', None, False, None),
        ]

    def test_counts_the_keywords_analysed_and_those_with_data(self):
        view = visibility_view(['spa', 'beach', 'golf'], self.ANSWERS)

        assert (view['keywords_analyzed'], view['keywords_with_data'], view['timestamp']) == (3, 2, DAY_2)

    def test_ranks_every_brand_named_in_the_answers(self):
        brands = visibility_view(['spa', 'beach'], self.ANSWERS)['brands']

        assert [(brand['name'], brand['mentions'], brand['keywords']) for brand in brands] == [(RIVAL, 3, 2), (HOTEL, 1, 1)]

    def test_narrows_the_leaderboard_to_matching_brand_names_only(self):
        view = visibility_view(['spa', 'beach'], self.ANSWERS, brand='sol')

        assert ([brand['name'] for brand in view['brands']], view['kpis']['answers']) == ([HOTEL], 3)

    def test_keeps_the_answers_of_one_persona(self):
        answers = {'spa': [_hotel_first('spa', DAY_2, persona='family'), _rival_only('spa', DAY_2)]}

        view = visibility_view(['spa'], answers, persona='family')

        assert (view['kpis']['answers'], view['kpis']['mention_rate']) == (1, 100.0)

    def test_reports_a_keyword_without_answers_for_the_persona_as_without_data(self):
        view = visibility_view(['spa'], {'spa': [_rival_only('spa', DAY_2)]}, persona='family')

        assert (view['keywords'][0]['has_data'], view['timestamp'], view['kpis']['mention_rate']) == (False, None, None)

    def test_is_empty_without_keywords(self):
        view = visibility_view([], {})

        assert (view['keywords'], view['brands'], view['kpis']['answers'], view['keywords_analyzed']) == ([], [], 0, 0)

    def test_compares_like_for_like_the_keywords_answered_in_both_runs(self):
        previous = {'spa': [_rival_only('spa', DAY_1)], 'golf': [_hotel_first('golf', DAY_1)]}

        change = visibility_view(['spa', 'beach', 'golf'], self.ANSWERS, previous_by_keyword=previous)['change']

        assert (change['keywords_compared'], change['deltas']['mention_rate'], change['trends']['mention_rate']) == (1, 50.0, 'improving')

    def test_has_no_change_without_a_previous_run(self):
        assert visibility_view(['spa', 'beach'], self.ANSWERS)['change'] is None

    def test_compares_the_previous_run_of_the_same_persona(self):
        latest = {'spa': [_hotel_first('spa', DAY_2, persona='family')]}
        previous = {'spa': [_rival_only('spa', DAY_1, persona='family'), _hotel_first('spa', DAY_1)]}

        change = visibility_view(['spa'], latest, previous_by_keyword=previous, persona='family')['change']

        assert change['deltas']['mention_rate'] == 100.0


class TestPeriodKey:
    @pytest.mark.parametrize(('period', 'expected'), [
        ('day', '2026-09-28'),
        ('week', '2026-W40'),
        ('month', '2026-09'),
    ])
    def test_names_the_day_iso_week_or_month_of_a_run(self, period, expected):
        assert period_key('2026-09-28T06:00:00.000000Z', period) == expected

    def test_counts_the_week_of_a_new_year_monday_in_the_first_iso_week(self):
        assert period_key('2024-12-30T06:00:00Z', 'week') == '2025-W01'

    @pytest.mark.parametrize('timestamp', ['', 'yesterday'])
    def test_has_no_period_for_an_unreadable_timestamp(self, timestamp):
        assert period_key(timestamp, 'day') is None


def _two_days() -> dict[str, list[Answer]]:
    """spa: rival only on day 1, the hotel first on day 2; beach: day 2 only (two runs); golf: nothing."""
    return {
        'spa': [_rival_only('spa', DAY_1), _hotel_first('spa', DAY_2)],
        'beach': [_rival_only('beach', DAY_2), _hotel_first('beach', DAY_2, provider='gemini')],
        'golf': [],
    }


class TestTrendView:
    def test_holds_every_answer_of_a_period_in_one_point(self):
        points = trend_view(['spa', 'beach', 'golf'], _two_days(), 'day')['trend_data']

        assert [(point['period'], point['keywords_with_data'], point['kpis']['answers'], point['kpis']['mention_rate']) for point in points] == [
            ('2026-09-01', 1, 1, 0.0), ('2026-09-08', 2, 3, 66.7),
        ]

    def test_counts_the_runs_of_a_period(self):
        answers = {'spa': [_rival_only('spa', DAY_1), _hotel_first('spa', DAY_1_LATER)]}

        assert trend_view(['spa'], answers, 'day')['trend_data'][0]['runs'] == 2

    def test_pools_each_keywords_latest_period_into_the_latest_standing(self):
        latest = trend_view(['spa', 'beach'], _two_days(), 'day')['latest']

        assert (latest['answers'], latest['mention_rate']) == (3, 66.7)

    def test_compares_like_for_like_only_the_keywords_measured_in_both_periods(self):
        change = trend_view(['spa', 'beach'], _two_days(), 'day')['change']

        assert (change['keywords_compared'], change['deltas']['mention_rate'], change['trends']['mention_rate']) == (1, 100.0, 'improving')

    def test_calls_a_trend_for_every_rate_and_score(self):
        change = trend_view(['spa', 'beach'], _two_days(), 'day')['change']

        assert set(change['trends']) == set(TRENDED_KPIS)

    def test_has_no_change_before_a_keyword_has_two_periods(self):
        answers = {'spa': [_hotel_first('spa', DAY_2)]}

        assert trend_view(['spa'], answers, 'day')['change'] is None

    def test_compares_the_last_two_of_three_periods(self):
        answers = {'spa': [_rival_only('spa', DAY_1), _rival_only('spa', DAY_2), _hotel_first('spa', '2026-09-15T06:00:00Z')]}

        change = trend_view(['spa'], answers, 'day')['change']

        assert (change['deltas']['mention_rate'], change['deltas']['answers']) == (100.0, 0)

    def test_offers_a_day_an_iso_week_and_a_month(self):
        assert PERIODS == ('day', 'week', 'month')

    def test_reports_each_keywords_latest_period_best_first(self):
        trends = trend_view(['spa', 'beach', 'golf'], _two_days(), 'day')['keyword_trends']

        assert [(row['keyword'], row['period'], row['kpis']['visibility_score']) for row in trends] == [
            ('spa', '2026-09-08', 100.0), ('beach', '2026-09-08', 50.0),
        ]

    def test_gives_each_keyword_its_change_since_its_previous_period(self):
        spa, beach = trend_view(['spa', 'beach'], _two_days(), 'day')['keyword_trends']

        assert (spa['change']['previous_period'], spa['change']['deltas']['visibility_score'], beach['change']) == ('2026-09-01', 100.0, None)

    def test_breaks_visibility_ties_by_keyword_name(self):
        answers = {'b': [_rival_only('b', DAY_1)], 'A': [_rival_only('A', DAY_1)], 'c': [_rival_only('c', DAY_1)]}

        assert [row['keyword'] for row in trend_view(['b', 'A', 'c'], answers, 'day')['keyword_trends']] == ['A', 'b', 'c']

    def test_counts_keywords_by_the_trend_of_their_visibility_score(self):
        answers = {
            'up': [_rival_only('up', DAY_1), _hotel_first('up', DAY_2)],
            'down': [_hotel_first('down', DAY_1), _rival_only('down', DAY_2)],
            'flat': [_rival_only('flat', DAY_1), _rival_only('flat', DAY_2)],
            'new': [_hotel_first('new', DAY_2)],
        }

        overall = trend_view(list(answers), answers, 'day')['overall']

        assert overall == {'improving_count': 1, 'declining_count': 1, 'stable_count': 2}

    def test_groups_runs_by_iso_week(self):
        answers = {'spa': [_rival_only('spa', DAY_1), _hotel_first('spa', DAY_2)]}

        assert [point['period'] for point in trend_view(['spa'], answers, 'week')['trend_data']] == ['2026-W36', '2026-W37']

    def test_measures_citations_against_the_owned_domains(self):
        latest = trend_view(['spa', 'beach'], _two_days(), 'day', ['hotel-sol.com'])['latest']

        assert latest['citation_rate'] == 66.7

    def test_counts_the_keywords_with_data(self):
        assert trend_view(['spa', 'beach', 'golf'], _two_days(), 'day')['keywords_with_data'] == 2

    def test_is_empty_without_answers(self):
        view = trend_view(['golf'], {'golf': []}, 'month')

        assert (view['trend_data'], view['keyword_trends'], view['change'], view['latest']['answers']) == ([], [], None, 0)
