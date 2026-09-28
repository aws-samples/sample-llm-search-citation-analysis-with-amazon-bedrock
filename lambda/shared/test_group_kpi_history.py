"""Tests for shared/group_kpi_history.py — the per-hotel KPI history behind the group report."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from shared.group_kpi_history import (
    DRIVER_IMPACT_KPIS,
    GROUP_RUN_MIN_COVERAGE,
    answers_by_run,
    build_group_kpi_history,
    query_keyword_rows_since,
    query_keyword_run_rows,
    run_models,
)
from shared.kpi_engine import KPI_IDS, TRENDED_KPIS, answers_from_rows

RUN_1 = '2026-09-01T06:00:00.000000Z'
RUN_2 = '2026-09-08T06:00:00.000000Z'
RUN_3 = '2026-09-15T06:00:00.000000Z'

HOTEL = 'Hotel Sol'
RIVAL = 'Hotel Mar'


def _brand(name: str, classification: str, rank: int) -> dict[str, Any]:
    return {'name': name, 'classification': classification, 'rank': rank, 'mention_count': 3}


def _answer(timestamp: str, *brands: dict[str, Any], provider: str = 'openai', model: str = 'gpt-5-mini', **extra: Any) -> dict[str, Any]:
    """One engine answer (SearchResults row) of a run."""
    return {
        'timestamp': timestamp,
        'provider': provider,
        'status': 'success',
        'query_prompt_id': 'default',
        'brands': list(brands),
        'citations': [],
        'metadata': {'model': model},
        **extra,
    }


def _hotel_first(timestamp: str, **kwargs: Any) -> dict[str, Any]:
    """An answer naming the hotel first and the rival second."""
    return _answer(timestamp, _brand(HOTEL, 'first_party', 1), _brand(RIVAL, 'competitor', 2), **kwargs)


def _hotel_at(timestamp: str, rank: int) -> dict[str, Any]:
    return _answer(timestamp, _brand(RIVAL, 'competitor', 1), _brand(HOTEL, 'first_party', rank))


def _rival_only(timestamp: str, **kwargs: Any) -> dict[str, Any]:
    """An answer naming only the rival."""
    return _answer(timestamp, _brand(RIVAL, 'competitor', 1), **kwargs)


def _history(
    rows_by_keyword: dict[str, list[dict[str, Any]]],
    keywords: list[str] | None = None,
    owned_domains: tuple[str, ...] = (),
) -> dict[str, Any]:
    stamped = {keyword: [{**row, 'keyword': keyword} for row in rows] for keyword, rows in rows_by_keyword.items()}
    return build_group_kpi_history(keywords or list(rows_by_keyword), stamped, owned_domains)


def _run(history: dict[str, Any], timestamp: str) -> dict[str, Any]:
    matches = [run for run in history['runs'] if run['timestamp'] == timestamp]
    assert len(matches) == 1
    return matches[0]


def _keyword(history: dict[str, Any], keyword: str) -> dict[str, Any]:
    matches = [entry for entry in history['keywords'] if entry['keyword'] == keyword]
    assert len(matches) == 1
    return matches[0]


def _key_condition(table: MagicMock) -> tuple[Any, Any]:
    """The partition and sort-key parts of the key condition of the table's last query."""
    condition = table.query.call_args.kwargs['KeyConditionExpression'].get_expression()
    assert condition['operator'] == 'AND'
    return condition['values'][0].get_expression(), condition['values'][1]


class TestQueries:
    @pytest.mark.parametrize(('query', 'value'), [(query_keyword_rows_since, RUN_1), (query_keyword_run_rows, RUN_1)])
    def test_reads_one_keyword_partition(self, query, value):
        table = MagicMock()
        table.query.return_value = {'Items': [{'timestamp': RUN_1}]}

        rows = query(table, 'hotel malaga', value)

        partition, _sort = _key_condition(table)
        assert (rows, partition['values'][0].name, partition['values'][1]) == ([{'timestamp': RUN_1}], 'keyword', 'hotel malaga')

    def test_reads_the_window_from_its_start_through_the_sort_key(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        query_keyword_rows_since(table, 'hotel malaga', RUN_1)

        _partition, window = _key_condition(table)
        assert (window.expression_operator, window.get_expression()['values'][0].name, window.get_expression()['values'][1]) == (
            '>=', 'timestamp_provider', RUN_1,
        )

    def test_reads_one_run_through_the_sort_key_prefix(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        query_keyword_run_rows(table, 'hotel malaga', RUN_2)

        _partition, run = _key_condition(table)
        assert (run.expression_operator, run.get_expression()['values'][0].name, run.get_expression()['values'][1]) == (
            'begins_with', 'timestamp_provider', f'{RUN_2}#',
        )

    @pytest.mark.parametrize('query', [query_keyword_rows_since, query_keyword_run_rows])
    def test_projects_the_answer_fields(self, query):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        query(table, 'hotel malaga', RUN_1)

        kwargs = table.query.call_args.kwargs
        assert (kwargs['ProjectionExpression'], kwargs['ExpressionAttributeNames']) == (
            'keyword, #ts, provider, #st, query_prompt_id, brands, citations, #md.model',
            {'#ts': 'timestamp', '#st': 'status', '#md': 'metadata'},
        )

    @pytest.mark.parametrize('query', [query_keyword_rows_since, query_keyword_run_rows])
    def test_follows_pagination(self, query):
        table = MagicMock()
        table.query.side_effect = [
            {'Items': [{'timestamp': RUN_1}], 'LastEvaluatedKey': {'keyword': 'k'}},
            {'Items': [{'timestamp': RUN_2}]},
        ]

        assert query(table, 'hotel malaga', RUN_1) == [{'timestamp': RUN_1}, {'timestamp': RUN_2}]


class TestAnswersByRun:
    def test_groups_answers_by_run_and_drops_those_without_a_timestamp(self):
        answers = answers_from_rows([_hotel_first(RUN_2), _hotel_first(RUN_1), _hotel_first(''), _rival_only(RUN_2)])

        assert {timestamp: len(run) for timestamp, run in answers_by_run(answers).items()} == {RUN_2: 2, RUN_1: 1}


class TestRunModels:
    def test_lists_each_engines_models_sorted(self):
        answers = answers_from_rows([
            _answer(RUN_1, provider='openai', model='gpt-5.2'),
            _answer(RUN_1, provider='openai', model='gpt-5-mini'),
            _answer(RUN_1, provider='gemini', model='gemini-3-flash-preview'),
            _answer(RUN_1, provider='gemini', model=''),
        ])

        assert run_models(answers) == {'gemini': ['gemini-3-flash-preview'], 'openai': ['gpt-5-mini', 'gpt-5.2']}

    def test_is_empty_when_no_answer_recorded_a_model(self):
        assert run_models(answers_from_rows([_answer(RUN_1, metadata={})])) == {}


class TestGroupRunKpis:
    """Each run's value pools the answers of all its keywords."""

    def test_pools_the_answers_of_every_keyword(self):
        """k1: 2 answers, both mention the hotel; k2: 1 answer, no mention -> 2 of 3."""
        history = _history({'k1': [_hotel_first(RUN_1), _hotel_first(RUN_1, provider='gemini')], 'k2': [_rival_only(RUN_1)]})

        kpis = _run(history, RUN_1)['kpis']
        assert (kpis['answers'], kpis['mentions'], kpis['mention_rate'], kpis['keyword_coverage']) == (3, 2, 66.7, 50.0)

    def test_reports_every_kpi_of_the_run(self):
        history = _history({'k1': [_hotel_first(RUN_1)]})

        assert set(KPI_IDS) <= set(_run(history, RUN_1)['kpis'])

    def test_measures_the_citation_kpis_against_the_owned_domains(self):
        history = _history(
            {'k1': [_hotel_first(RUN_1, citations=['https://hotel-sol.com/spa', 'https://booking.com/x']), _rival_only(RUN_1, provider='gemini')]},
            owned_domains=('hotel-sol.com',),
        )

        kpis = _run(history, RUN_1)['kpis']
        assert (kpis['citations'], kpis['citation_rate'], kpis['citation_share']) == (1, 50.0, 50.0)

    def test_leaves_the_citation_kpis_empty_without_owned_domains(self):
        kpis = _run(_history({'k1': [_hotel_first(RUN_1, citations=['https://hotel-sol.com/'])]}), RUN_1)['kpis']

        assert (kpis['citations'], kpis['citation_rate']) == (None, None)

    def test_lists_runs_oldest_first(self):
        history = _history({'k1': [_hotel_first(RUN_3), _hotel_first(RUN_1), _hotel_first(RUN_2)]})

        assert [run['timestamp'] for run in history['runs']] == [RUN_1, RUN_2, RUN_3]

    def test_ignores_rows_that_are_not_answers(self):
        history = _history({'k1': [
            _hotel_first(RUN_1),
            _hotel_first(RUN_2, status='error'),
            _hotel_first(RUN_3, provider='brave'),
            {**_hotel_first(RUN_1), 'timestamp': ''},
        ]})

        assert ([run['timestamp'] for run in history['runs']], _run(history, RUN_1)['kpis']['answers']) == ([RUN_1], 1)

    def test_reports_the_models_that_answered_in_the_run(self):
        history = _history({
            'k1': [_hotel_first(RUN_1, model='gpt-5.2')],
            'k2': [_rival_only(RUN_1, provider='gemini', model='gemini-2.5-pro')],
        })

        assert _run(history, RUN_1)['models'] == {'gemini': ['gemini-2.5-pro'], 'openai': ['gpt-5.2']}

    def test_reports_an_empty_history_for_a_group_without_runs(self):
        assert _history({'k1': []}) == {'runs': [], 'keywords': [{'keyword': 'k1', 'runs': []}]}

    def test_reports_an_empty_history_for_a_group_without_keywords(self):
        assert build_group_kpi_history([], {}) == {'runs': [], 'keywords': []}

    def test_keeps_the_internal_keyword_kpis_out_of_the_response(self):
        run = _run(_history({'k1': [_hotel_first(RUN_1)]}), RUN_1)

        assert set(run) == {'timestamp', 'keywords_with_data', 'keywords_total', 'coverage', 'is_group_run', 'kpis', 'models', 'change'}


class TestGroupRunCoverage:
    """A one-keyword rerun is not the hotel's visibility."""

    def test_reports_how_many_keywords_a_run_answered(self):
        history = _history({'k1': [_hotel_first(RUN_1)], 'k2': [], 'k3': [], 'k4': []})

        run = _run(history, RUN_1)
        assert (run['keywords_with_data'], run['keywords_total'], run['coverage']) == (1, 4, 25.0)

    def test_does_not_count_a_keyword_whose_engines_all_failed_as_answered(self):
        history = _history({'k1': [_hotel_first(RUN_1)], 'k2': [_hotel_first(RUN_1, status='error')]})

        assert (_run(history, RUN_1)['keywords_with_data'], _run(history, RUN_1)['is_group_run']) == (1, True)

    def test_marks_a_run_answering_half_the_keywords_as_a_group_run(self):
        history = _history({'k1': [_hotel_first(RUN_1)], 'k2': [_hotel_first(RUN_1)], 'k3': [], 'k4': []})

        assert (_run(history, RUN_1)['is_group_run'], GROUP_RUN_MIN_COVERAGE) == (True, 50.0)

    def test_does_not_mark_a_run_below_half_as_a_group_run(self):
        history = _history({'k1': [_hotel_first(RUN_1)], 'k2': [], 'k3': []})

        assert _run(history, RUN_1)['is_group_run'] is False

    def test_rounds_coverage_to_one_decimal(self):
        history = _history({'k1': [_hotel_first(RUN_1)], 'k2': [], 'k3': []})

        assert _run(history, RUN_1)['coverage'] == 33.3


def _two_group_runs() -> dict[str, Any]:
    """k1 loses the hotel between RUN_1 and RUN_2; k2 gains it in 3rd place; k3 stays the same.

    RUN_1: 3 answers, 2 mentions at positions 1 and 1.
    RUN_2: 3 answers, 2 mentions at positions 3 and 1.
    """
    return _history({
        'k1': [_hotel_first(RUN_1), _rival_only(RUN_2)],
        'k2': [_rival_only(RUN_1), _hotel_at(RUN_2, 3)],
        'k3': [_hotel_first(RUN_1), _hotel_first(RUN_2)],
    })


class TestChangeBetweenGroupRuns:
    def test_the_first_group_run_has_nothing_to_compare_with(self):
        assert _run(_two_group_runs(), RUN_1)['change'] is None

    def test_compares_with_the_previous_group_run(self):
        assert _run(_two_group_runs(), RUN_2)['change']['previous_timestamp'] == RUN_1

    @pytest.mark.parametrize(('kpi', 'expected'), [
        ('mention_rate', 0.0),
        ('share_of_voice', 0.0),
        ('average_position', 1.0),
        # 66.7 -> 33.3
        ('top_1_share', -33.4),
        ('top_3_share', 0.0),
        # 66.7 -> (1 + 0.81) / 3 = 60.3
        ('visibility_score', -6.4),
        ('citation_rate', None),
    ])
    def test_reports_the_group_kpi_deltas(self, kpi, expected):
        assert _run(_two_group_runs(), RUN_2)['change']['deltas'][kpi] == expected

    def test_calls_the_trend_of_every_rate_and_score(self):
        trends = _run(_two_group_runs(), RUN_2)['change']['trends']

        assert (set(trends), trends['mention_rate'], trends['average_position'], trends['visibility_score']) == (
            set(TRENDED_KPIS), 'stable', 'declining', 'declining',
        )

    def test_lists_the_keywords_that_moved_and_skips_the_steady_one(self):
        drivers = _run(_two_group_runs(), RUN_2)['change']['drivers']

        assert [driver['keyword'] for driver in drivers] == ['k1', 'k2']

    def test_explains_a_keyword_that_lost_the_hotel(self):
        k1 = _run(_two_group_runs(), RUN_2)['change']['drivers'][0]

        assert (k1['mention'], k1['deltas']['mention_rate'], k1['deltas']['average_position'], k1['impact']) == (
            'lost', -100.0, None, {'mention_rate': -33.33, 'visibility_score': -33.33},
        )

    def test_explains_a_keyword_that_gained_the_hotel(self):
        k2 = _run(_two_group_runs(), RUN_2)['change']['drivers'][1]

        assert (k2['mention'], k2['deltas']['visibility_score'], k2['impact']) == (
            'gained', 81.0, {'mention_rate': 33.33, 'visibility_score': 27.0},
        )

    def test_weights_each_drivers_impact_by_its_share_of_the_runs_answers(self):
        """k1 has 2 of the run's 4 answers and loses the hotel in both."""
        history = _history({
            'k1': [_hotel_first(RUN_1), _hotel_first(RUN_1, provider='gemini'), _rival_only(RUN_2), _rival_only(RUN_2, provider='gemini')],
            'k2': [_hotel_first(RUN_1), _hotel_first(RUN_2)],
            'k3': [_hotel_first(RUN_1), _hotel_first(RUN_2)],
        })

        change = _run(history, RUN_2)['change']
        assert (change['drivers'][0]['impact']['mention_rate'], change['deltas']['mention_rate']) == (-50.0, -50.0)

    def test_reports_the_impact_of_every_driver_kpi(self):
        assert DRIVER_IMPACT_KPIS == ('mention_rate', 'visibility_score')

    def test_orders_drivers_by_mention_rate_impact_then_visibility_impact(self):
        history = _history({
            'a-small': [_hotel_first(RUN_1), _hotel_at(RUN_2, 2)],
            'b-lost': [_hotel_first(RUN_1), _rival_only(RUN_2)],
            'c-bigger': [_hotel_first(RUN_1), _hotel_at(RUN_2, 4)],
        })

        assert [driver['keyword'] for driver in _run(history, RUN_2)['change']['drivers']] == ['b-lost', 'c-bigger', 'a-small']

    def test_gives_no_mention_rate_impact_to_a_keyword_whose_mention_rate_held(self):
        history = _history({
            'k1': [_hotel_first(RUN_1), _hotel_at(RUN_2, 4)],
            'k2': [_hotel_first(RUN_1), _hotel_first(RUN_2)],
        })

        assert _run(history, RUN_2)['change']['drivers'][0]['impact'] == {'mention_rate': 0.0, 'visibility_score': -13.55}

    def test_reports_a_keyword_whose_only_change_is_its_answer_count(self):
        history = _history({
            'k1': [_hotel_first(RUN_1), _hotel_first(RUN_1, provider='gemini'), _hotel_first(RUN_2)],
            'k2': [_hotel_first(RUN_1), _hotel_first(RUN_2)],
        })

        drivers = _run(history, RUN_2)['change']['drivers']
        assert [(driver['keyword'], driver['mention'], driver['deltas']['answers']) for driver in drivers] == [('k1', None, -1)]

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
    def test_lists_each_keyword_run_oldest_first_with_its_kpis(self):
        k1 = _keyword(_two_group_runs(), 'k1')

        kpis = k1['runs'][0]['kpis']
        assert ([run['timestamp'] for run in k1['runs']], kpis['mention_rate'], kpis['share_of_voice'], kpis['visibility_score']) == (
            [RUN_1, RUN_2], 100.0, 50.0, 100.0,
        )

    def test_the_first_keyword_run_has_no_change(self):
        assert _keyword(_two_group_runs(), 'k1')['runs'][0]['change'] is None

    def test_explains_how_a_keyword_changed_since_its_previous_run(self):
        change = _keyword(_two_group_runs(), 'k2')['runs'][1]['change']

        assert (change['previous_timestamp'], change['mention'], change['deltas']['top_3_share'], change['deltas']['average_position']) == (
            RUN_1, 'gained', 100.0, None,
        )

    def test_compares_a_rerun_with_the_keywords_own_previous_run(self):
        history = _history({
            'k1': [_hotel_first(RUN_1), _hotel_first(RUN_3)],
            'k2': [_hotel_first(RUN_1), _rival_only(RUN_2)],
        })

        change = _keyword(history, 'k2')['runs'][1]['change']
        assert (change['previous_timestamp'], change['mention']) == (RUN_1, 'lost')

    def test_reports_no_mention_change_when_the_hotel_stays_mentioned(self):
        assert _keyword(_two_group_runs(), 'k3')['runs'][1]['change']['mention'] is None

    def test_keeps_the_keyword_order_of_the_group(self):
        history = _history({'b': [_hotel_first(RUN_1)], 'a': [_hotel_first(RUN_1)]}, keywords=['b', 'a'])

        assert [entry['keyword'] for entry in history['keywords']] == ['b', 'a']
