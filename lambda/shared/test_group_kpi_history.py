"""Tests for shared/group_kpi_history.py — the per-hotel KPI history behind the group report."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from shared.group_kpi_history import (
    GROUP_RUN_MIN_COVERAGE,
    build_group_kpi_history,
    delta,
    query_keyword_rows_since,
    run_models,
)

RUN_1 = '2026-09-01T06:00:00.000000Z'
RUN_2 = '2026-09-08T06:00:00.000000Z'
RUN_3 = '2026-09-15T06:00:00.000000Z'

HOTEL = 'Hotel Sol'
RIVAL = 'Hotel Mar'


def _brand(name: str, classification: str, rank: int, mentions: int = 1) -> dict[str, Any]:
    return {'name': name, 'classification': classification, 'rank': rank, 'mention_count': mentions}


def _answer(timestamp: str, *brands: dict[str, Any], provider: str = 'openai', model: str = 'gpt-5-mini') -> dict[str, Any]:
    """One provider answer (SearchResults row) of a run."""
    return {
        'timestamp': timestamp,
        'provider': provider,
        'query_prompt_id': 'default',
        'brands': list(brands),
        'metadata': {'model': model},
    }


def _hotel_first(timestamp: str, **kwargs: Any) -> dict[str, Any]:
    """An answer ranking the hotel first and the rival second, one mention each."""
    return _answer(timestamp, _brand(HOTEL, 'first_party', 1), _brand(RIVAL, 'competitor', 2), **kwargs)


def _rival_only(timestamp: str, **kwargs: Any) -> dict[str, Any]:
    """An answer mentioning only the rival."""
    return _answer(timestamp, _brand(RIVAL, 'competitor', 1), **kwargs)


def _history(rows_by_keyword: dict[str, list[dict[str, Any]]], keywords: list[str] | None = None) -> dict[str, Any]:
    return build_group_kpi_history(keywords or list(rows_by_keyword), rows_by_keyword, total_providers=4)


def _run(history: dict[str, Any], timestamp: str) -> dict[str, Any]:
    matches = [run for run in history['runs'] if run['timestamp'] == timestamp]
    assert len(matches) == 1
    return matches[0]


def _keyword(history: dict[str, Any], keyword: str) -> dict[str, Any]:
    matches = [entry for entry in history['keywords'] if entry['keyword'] == keyword]
    assert len(matches) == 1
    return matches[0]


class TestQueryKeywordRowsSince:
    def test_reads_only_the_window_through_the_sort_key(self):
        table = MagicMock()
        table.query.return_value = {'Items': [{'timestamp': RUN_2}]}

        rows = query_keyword_rows_since(table, 'hotel malaga', RUN_1)

        condition = table.query.call_args.kwargs['KeyConditionExpression'].get_expression()
        partition = condition['values'][0].get_expression()
        assert (rows, condition['operator'], partition['values'][0].name, partition['values'][1]) == (
            [{'timestamp': RUN_2}], 'AND', 'keyword', 'hotel malaga',
        )

    def test_compares_the_sort_key_as_greater_or_equal(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        query_keyword_rows_since(table, 'hotel malaga', RUN_1)

        window = table.query.call_args.kwargs['KeyConditionExpression'].get_expression()['values'][1]
        assert (window.expression_operator, window.get_expression()['values'][0].name, window.get_expression()['values'][1]) == (
            '>=', 'timestamp_provider', RUN_1,
        )

    def test_projects_the_metrics_fields_and_the_answering_model(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        query_keyword_rows_since(table, 'hotel malaga', RUN_1)

        kwargs = table.query.call_args.kwargs
        assert (kwargs['ProjectionExpression'], kwargs['ExpressionAttributeNames']) == (
            '#ts, provider, brands, query_prompt_id, #md.model',
            {'#ts': 'timestamp', '#md': 'metadata'},
        )

    def test_follows_pagination(self):
        table = MagicMock()
        table.query.side_effect = [
            {'Items': [{'timestamp': RUN_1}], 'LastEvaluatedKey': {'keyword': 'k'}},
            {'Items': [{'timestamp': RUN_2}]},
        ]

        assert query_keyword_rows_since(table, 'hotel malaga', RUN_1) == [{'timestamp': RUN_1}, {'timestamp': RUN_2}]


class TestRunModels:
    def test_lists_each_providers_models_sorted(self):
        rows = [
            _answer(RUN_1, provider='openai', model='gpt-5.2'),
            _answer(RUN_1, provider='openai', model='gpt-5-mini'),
            _answer(RUN_1, provider='gemini', model='gemini-3-flash-preview'),
        ]

        assert run_models(rows) == {'gemini': ['gemini-3-flash-preview'], 'openai': ['gpt-5-mini', 'gpt-5.2']}

    @pytest.mark.parametrize('metadata', [None, {}, {'model': ''}, {'model': 5}, 'gpt-5'])
    def test_skips_answers_that_recorded_no_model(self, metadata):
        assert run_models([{'provider': 'openai', 'metadata': metadata}]) == {}

    def test_names_an_answer_without_a_provider_unknown(self):
        assert run_models([{'metadata': {'model': 'sonar'}}]) == {'unknown': ['sonar']}


class TestDelta:
    def test_rounds_the_difference(self):
        assert delta(33.3333, 11.1111) == 22.22

    @pytest.mark.parametrize(('current', 'previous'), [(None, 1.0), (1.0, None), (None, None)])
    def test_is_unknown_when_either_side_is(self, current, previous):
        assert delta(current, previous) is None


class TestGroupRunKpis:
    """Each run's group values come from the same formulas as /visibility."""

    def test_citation_rate_counts_keywords_whose_answers_mention_the_hotel(self):
        history = _history({'k1': [_hotel_first(RUN_1)], 'k2': [_rival_only(RUN_1)]})

        assert _run(history, RUN_1)['summary']['coverage_rate'] == 50.0

    def test_share_of_voice_is_the_equal_keyword_mean(self):
        """k1: 1 of 2 mentions (50%), k2: 0% -> 25%."""
        history = _history({'k1': [_hotel_first(RUN_1)], 'k2': [_rival_only(RUN_1)]})

        assert _run(history, RUN_1)['summary']['first_party_avg_sov'] == 25.0

    def test_prominence_uses_every_answer_as_the_denominator(self):
        """k1 answers: rank 1 and not mentioned -> 50% rank #1 for k1, the group mean."""
        history = _history({'k1': [_hotel_first(RUN_1), _rival_only(RUN_1, provider='gemini')]})

        summary = _run(history, RUN_1)['summary']
        assert (summary['rank_1_share'], summary['top_3_share'], summary['mean_rank']) == (50.0, 50.0, 1.0)

    def test_lists_runs_oldest_first(self):
        history = _history({'k1': [_hotel_first(RUN_3), _hotel_first(RUN_1), _hotel_first(RUN_2)]})

        assert [run['timestamp'] for run in history['runs']] == [RUN_1, RUN_2, RUN_3]

    def test_ignores_rows_without_a_run_timestamp(self):
        history = _history({'k1': [_hotel_first(RUN_1), {**_hotel_first(RUN_1), 'timestamp': ''}, {'provider': 'openai'}]})

        assert [run['timestamp'] for run in history['runs']] == [RUN_1]

    def test_reports_the_models_that_answered_in_the_run(self):
        history = _history({
            'k1': [_hotel_first(RUN_1, model='gpt-5.2')],
            'k2': [_rival_only(RUN_1, provider='gemini', model='gemini-2.5-pro')],
        })

        assert _run(history, RUN_1)['models'] == {'gemini': ['gemini-2.5-pro'], 'openai': ['gpt-5.2']}

    def test_reports_an_empty_history_for_a_group_without_runs(self):
        assert _history({'k1': []}) == {'runs': [], 'keywords': [{'keyword': 'k1', 'runs': []}]}


class TestGroupRunCoverage:
    """A one-keyword rerun is not the hotel's visibility."""

    def test_reports_how_many_keywords_a_run_covered(self):
        history = _history({'k1': [_hotel_first(RUN_1)], 'k2': [], 'k3': [], 'k4': []})

        run = _run(history, RUN_1)
        assert (run['keywords_with_data'], run['keywords_total'], run['coverage']) == (1, 4, 25.0)

    def test_marks_a_run_covering_half_the_keywords_as_a_group_run(self):
        history = _history({'k1': [_hotel_first(RUN_1)], 'k2': [_hotel_first(RUN_1)], 'k3': [], 'k4': []})

        assert (_run(history, RUN_1)['is_group_run'], GROUP_RUN_MIN_COVERAGE) == (True, 50.0)

    def test_does_not_mark_a_run_below_half_as_a_group_run(self):
        history = _history({'k1': [_hotel_first(RUN_1)], 'k2': [], 'k3': []})

        assert _run(history, RUN_1)['is_group_run'] is False

    def test_rounds_coverage_to_one_decimal(self):
        history = _history({'k1': [_hotel_first(RUN_1)], 'k2': [], 'k3': []})

        assert _run(history, RUN_1)['coverage'] == 33.3

    def test_reports_no_coverage_for_a_group_without_keywords(self):
        assert build_group_kpi_history([], {}, total_providers=4) == {'runs': [], 'keywords': []}

    def test_keeps_the_internal_keyword_rows_out_of_the_response(self):
        history = _history({'k1': [_hotel_first(RUN_1)]})

        assert 'keyword_rows' not in _run(history, RUN_1)



def _two_group_runs() -> dict[str, Any]:
    """k1 loses the hotel between RUN_1 and RUN_2; k2 gains it at a lower rank; k3 stays the same."""
    return _history({
        'k1': [_hotel_first(RUN_1), _rival_only(RUN_2)],
        'k2': [_rival_only(RUN_1), _answer(RUN_2, _brand(RIVAL, 'competitor', 1), _brand(HOTEL, 'first_party', 3))],
        'k3': [_hotel_first(RUN_1), _hotel_first(RUN_2)],
    })


class TestChangeBetweenGroupRuns:
    def test_the_first_group_run_has_nothing_to_compare_with(self):
        assert _run(_two_group_runs(), RUN_1)['change'] is None

    def test_compares_with_the_previous_group_run(self):
        assert _run(_two_group_runs(), RUN_2)['change']['previous_timestamp'] == RUN_1

    def test_reports_the_group_kpi_deltas(self):
        """Citation rate 66.7 -> 66.7, rank #1 share 66.7 -> 33.3, mean rank 1.0 -> 2.0."""
        deltas = _run(_two_group_runs(), RUN_2)['change']['deltas']

        assert deltas == {
            'coverage_rate': 0.0,
            'first_party_avg_sov': 0.0,
            'rank_1_share': -33.4,
            'top_3_share': 0.0,
            'mean_rank': 1.0,
        }

    def test_lists_the_keywords_that_moved_and_skips_the_steady_one(self):
        drivers = _run(_two_group_runs(), RUN_2)['change']['drivers']

        assert [driver['keyword'] for driver in drivers] == ['k1', 'k2']

    def test_explains_a_keyword_that_lost_the_hotel(self):
        k1 = _run(_two_group_runs(), RUN_2)['change']['drivers'][0]

        assert k1 == {
            'keyword': 'k1',
            'changes': {'mention': 'lost', 'first_party_sov': -50.0, 'rank_1_share': -100.0, 'top_3_share': -100.0, 'mean_rank': None},
            'impact': {'coverage_rate': -33.33, 'first_party_avg_sov': -16.67},
        }

    def test_explains_a_keyword_that_gained_the_hotel(self):
        k2 = _run(_two_group_runs(), RUN_2)['change']['drivers'][1]

        assert (k2['changes']['mention'], k2['impact']['coverage_rate']) == ('gained', 33.33)

    def test_orders_drivers_by_their_citation_rate_impact_then_share_of_voice(self):
        history = _history({
            'a-small': [_hotel_first(RUN_1), _answer(RUN_2, _brand(HOTEL, 'first_party', 1), _brand(RIVAL, 'competitor', 2, mentions=3))],
            'b-lost': [_hotel_first(RUN_1), _rival_only(RUN_2)],
            'c-bigger': [_hotel_first(RUN_1), _answer(RUN_2, _brand(HOTEL, 'first_party', 1), _brand(RIVAL, 'competitor', 2, mentions=9))],
        })

        assert [driver['keyword'] for driver in _run(history, RUN_2)['change']['drivers']] == ['b-lost', 'c-bigger', 'a-small']

    def test_names_keywords_that_entered_or_left_the_comparison(self):
        history = _history({
            'k1': [_hotel_first(RUN_1), _hotel_first(RUN_2)],
            'k2': [_hotel_first(RUN_1)],
            'k3': [_hotel_first(RUN_2)],
        })

        change = _run(history, RUN_2)['change']
        assert (change['keywords_entered'], change['keywords_left']) == (['k3'], ['k2'])

    def test_skips_a_partial_run_when_looking_for_the_previous_group_run(self):
        """RUN_2 reruns one keyword of three; RUN_3 compares with RUN_1."""
        history = _history({
            'k1': [_hotel_first(RUN_1), _rival_only(RUN_2), _hotel_first(RUN_3)],
            'k2': [_hotel_first(RUN_1), _hotel_first(RUN_3)],
            'k3': [_hotel_first(RUN_1), _hotel_first(RUN_3)],
        })

        assert (_run(history, RUN_2)['change'], _run(history, RUN_3)['change']['previous_timestamp']) == (None, RUN_1)

    def test_sorts_keyword_names_case_insensitively(self):
        history = _history({
            'b': [_hotel_first(RUN_1), _rival_only(RUN_2)],
            'A': [_hotel_first(RUN_1), _rival_only(RUN_2)],
            'c': [_hotel_first(RUN_2)],
            'B2': [_hotel_first(RUN_2)],
        }, keywords=['b', 'A', 'c', 'B2'])

        change = _run(history, RUN_2)['change']
        assert ([driver['keyword'] for driver in change['drivers']], change['keywords_entered']) == (['A', 'b'], ['B2', 'c'])


class TestKeywordDrillDown:
    def test_lists_each_keyword_run_oldest_first_with_its_values(self):
        k1 = _keyword(_two_group_runs(), 'k1')

        assert k1['runs'][0] == {
            'timestamp': RUN_1,
            'first_party_mentioned': True,
            'first_party_sov': 50.0,
            'rank_1_share': 100.0,
            'top_3_share': 100.0,
            'mean_rank': 1.0,
            'first_party_best_rank': 1,
            'answers': 1,
            'mentioned_answers': 1,
            'first_party_score': k1['runs'][0]['first_party_score'],
            'change': None,
        }

    def test_scores_the_hotel_in_each_keyword_run(self):
        k1 = _keyword(_two_group_runs(), 'k1')

        assert (k1['runs'][0]['first_party_score'] > 0, k1['runs'][1]['first_party_score']) == (True, 0.0)

    def test_explains_how_a_keyword_changed_since_its_previous_run(self):
        k2 = _keyword(_two_group_runs(), 'k2')

        assert k2['runs'][1]['change'] == {
            'previous_timestamp': RUN_1,
            'mention': 'gained',
            'first_party_sov': 50.0,
            'rank_1_share': 0.0,
            'top_3_share': 100.0,
            'mean_rank': None,
        }

    def test_compares_a_rerun_with_the_keywords_own_previous_run(self):
        history = _history({
            'k1': [_hotel_first(RUN_1), _hotel_first(RUN_3)],
            'k2': [_hotel_first(RUN_1), _rival_only(RUN_2)],
        })

        assert _keyword(history, 'k2')['runs'][1]['change']['previous_timestamp'] == RUN_1

    def test_reports_no_mention_change_when_the_hotel_stays_mentioned(self):
        assert _keyword(_two_group_runs(), 'k3')['runs'][1]['change']['mention'] is None

    def test_keeps_the_keyword_order_of_the_group(self):
        history = _history({'b': [_hotel_first(RUN_1)], 'a': [_hotel_first(RUN_1)]}, keywords=['b', 'a'])

        assert [entry['keyword'] for entry in history['keywords']] == ['b', 'a']
