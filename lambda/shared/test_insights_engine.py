"""Tests for shared/insights_engine.py — the facts and insights behind the Insights report."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from shared.group_kpi_history import build_group_kpi_history
from shared.insights_engine import (
    BLOCK_BY_KIND,
    ENGINE_CITED_MIN,
    ENGINE_TOP1_MIN,
    INSIGHT_KINDS,
    SUBBRAND_MIN_MENTIONS,
    SUBBRAND_POSITION_GAP,
    SUBBRAND_SENTIMENT_GAP,
    UNSTABLE_POSITION_RANGE,
    compute_insights,
    derive_insights,
    engine_facts,
    portfolio_facts,
    stability_facts,
)
from shared.kpi_engine import KPI_IDS, Answer, answers_from_rows, brand_table, engine_breakdown
from testing.search_results_fixtures import search_result_row
from testing.sentiment_examples_fixtures import stored_brand

RUN_1 = '2026-09-01T06:00:00.000000Z'
RUN_2 = '2026-09-08T06:00:00.000000Z'
RUN_3 = '2026-09-15T06:00:00.000000Z'
HOTEL = 'Hotel Sol'
SPA = 'Sol Spa'
BEACH = 'Sol Beach'
RIVAL = 'Hotel Mar'
OWNED = ('hotel-sol.com',)
OWNED_URL = 'https://www.hotel-sol.com/rooms'
OTHER_URL = 'https://booking.com/hotel-sol'

#: One brand sighting: its rank and sentiment label.
Sighting = tuple[int | None, str | None]
#: One run of a keyword's history: the brand's average position and its mention change since the previous run.
RunPoint = tuple[float | None, str | None]


def _answer(keyword: str, provider: str, *brands: dict[str, Any], run: str = RUN_1, cites: Iterable[str] = ()) -> dict[str, Any]:
    """One stored answer of ``provider`` to ``keyword`` in ``run``, naming ``brands`` and citing ``cites``."""
    return search_result_row(keyword, provider, brands, timestamp=run, citations=list(cites))


def _sol(rank: int | None = 1, sentiment: str | None = 'positive', name: str = HOTEL) -> dict[str, Any]:
    """A first-party brand (the hotel by default) seen at ``rank`` with ``sentiment``."""
    return stored_brand(name, sentiment, rank=rank)


def _rival(rank: int | None = 1) -> dict[str, Any]:
    return stored_brand(RIVAL, None, classification='competitor', rank=rank)


def _answers(*rows: dict[str, Any]) -> list[Answer]:
    return answers_from_rows(rows)


def _history(rows_by_keyword: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """The keyword drill-down of the group history built from ``rows_by_keyword``."""
    return build_group_kpi_history(list(rows_by_keyword), rows_by_keyword, OWNED)['keywords']


def _engine_answers(engine: str, ranked_first: int, citing: int, total: int = 10) -> list[Answer]:
    """``total`` answers of ``engine``: the first ``ranked_first`` rank the hotel 1st (the rest 2nd), the first ``citing`` cite its site."""
    return _answers(*(
        _answer(f'k{index}', engine, _sol(1 if index < ranked_first else 2), cites=[OWNED_URL if index < citing else OTHER_URL])
        for index in range(total)
    ))


def _at(rank: int | None, sentiment: str | None = 'positive', times: int = SUBBRAND_MIN_MENTIONS) -> list[Sighting]:
    """``times`` sightings of a brand at ``rank`` with ``sentiment``."""
    return [(rank, sentiment)] * times


def _brand_rows(sightings_by_brand: Mapping[str, Sequence[Sighting]]) -> list[dict[str, Any]]:
    """One answer per sighting, each naming the first-party brand alone."""
    return [
        _answer(f'{name} {index}', 'openai', _sol(rank, sentiment, name))
        for name, sightings in sightings_by_brand.items()
        for index, (rank, sentiment) in enumerate(sightings)
    ]


def _portfolio(sightings_by_brand: Mapping[str, Sequence[Sighting]]) -> list[dict[str, Any]]:
    return portfolio_facts(_answers(*_brand_rows(sightings_by_brand)))


def _gaps(portfolio: list[dict[str, Any]]) -> dict[str, tuple[float | None, float | None, bool]]:
    return {row['name']: (row['position_gap'], row['sentiment_gap'], row['weak']) for row in portfolio}


def _keyword(name: str, *runs: RunPoint) -> dict[str, Any]:
    """A keyword's history: one run per ``(average position, mention change)`` pair, oldest first; the first run has no change."""
    return {
        'keyword': name,
        'runs': [
            {'timestamp': f'run-{index}', 'kpis': {'average_position': position}, 'change': {'mention': mention} if index else None}
            for index, (position, mention) in enumerate(runs)
        ],
    }


def _engine(engine: str, play: str = 'get_cited', answers: int = 10, top_1: float | None = 60.0, cited: float | None = 10.0) -> dict[str, Any]:
    """An engine fact with the KPIs an engine insight reads."""
    return {'engine': engine, 'play': play, 'kpis': {'answers': answers, 'top_1_share': top_1, 'citation_rate': cited}}


def _brand(name: str, position_gap: float | None = 2.0, sentiment_gap: float | None = 0.0, mentions: int = 5, *, weak: bool = True) -> dict[str, Any]:
    """A portfolio fact."""
    return {
        'name': name,
        'mentions': mentions,
        'average_position': 3.0,
        'net_sentiment': 50.0,
        'citations': None,
        'position_gap': position_gap,
        'sentiment_gap': sentiment_gap,
        'weak': weak,
    }


def _swing(keyword: str, flips: int = 0, position_range: float = 3.0, *, unstable: bool = True) -> dict[str, Any]:
    """A stability fact."""
    return {
        'keyword': keyword,
        'runs': 2,
        'position_min': 1.0,
        'position_max': round(1.0 + position_range, 2),
        'position_range': position_range,
        'flips': flips,
        'unstable': unstable,
    }


def _facts(
    engines: Iterable[dict[str, Any]] = (),
    portfolio: Iterable[dict[str, Any]] = (),
    stability: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    return {'engines': list(engines), 'portfolio': list(portfolio), 'stability': list(stability)}


def _ids(insights: list[dict[str, Any]]) -> list[str]:
    return [insight['id'] for insight in insights]


class TestThresholds:
    def test_pins_the_thresholds_of_the_contract(self):
        assert (ENGINE_TOP1_MIN, ENGINE_CITED_MIN, SUBBRAND_MIN_MENTIONS, SUBBRAND_POSITION_GAP, SUBBRAND_SENTIMENT_GAP, UNSTABLE_POSITION_RANGE) == (
            50.0, 30.0, 3, 2.0, 30.0, 3.0,
        )

    def test_names_a_report_block_for_every_kind_in_rule_order(self):
        assert (INSIGHT_KINDS, BLOCK_BY_KIND) == (
            ('engine_play', 'weak_subbrand', 'unstable_keyword'),
            {
                'engine_play': 'insights_engine_playbook',
                'weak_subbrand': 'insights_brand_portfolio',
                'unstable_keyword': 'insights_run_stability',
            },
        )


class TestEngineFacts:
    def test_lists_every_engine_in_name_order_with_its_play_and_kpis(self):
        rows = engine_facts(_answers(_answer('k', 'openai', _sol()), _answer('k', 'gemini', _sol(2))), OWNED)

        assert ([row['engine'] for row in rows], {key for row in rows for key in row}) == (['gemini', 'openai'], {'engine', 'play', 'kpis'})
        assert all(set(KPI_IDS) <= set(row['kpis']) for row in rows)

    @pytest.mark.parametrize(('ranked_first', 'citing', 'play'), [
        pytest.param(5, 3, 'defend', id='ranked_first_and_cited_at_both_thresholds'),
        pytest.param(5, 2, 'get_cited', id='ranked_first_but_cited_below_30'),
        pytest.param(4, 3, 'get_ranked_first', id='cited_but_first_below_50'),
        pytest.param(4, 2, 'get_mentioned_and_cited', id='both_below'),
    ])
    def test_calls_the_play_from_the_top_1_share_and_the_citation_rate(self, ranked_first, citing, play):
        [row] = engine_facts(_engine_answers('openai', ranked_first, citing), OWNED)

        assert (row['kpis']['top_1_share'], row['kpis']['citation_rate'], row['play']) == (ranked_first * 10.0, citing * 10.0, play)

    @pytest.mark.parametrize(('ranked_first', 'play'), [(5, 'defend'), (4, 'get_ranked_first')])
    def test_decides_by_the_top_1_share_alone_without_owned_domains(self, ranked_first, play):
        [row] = engine_facts(_engine_answers('claude', ranked_first, citing=10))

        assert (row['kpis']['citation_rate'], row['play']) == (None, play)

    def test_is_empty_without_answers(self):
        assert engine_facts([], OWNED) == []


class TestPortfolioFacts:
    def test_measures_each_qualifying_first_party_brand_against_the_best(self):
        assert _portfolio({HOTEL: _at(1), SPA: _at(4)}) == [
            {
                'name': HOTEL, 'mentions': 3, 'average_position': 1.0, 'net_sentiment': 100.0, 'citations': None,
                'position_gap': 0.0, 'sentiment_gap': 0.0, 'weak': False,
            },
            {
                'name': SPA, 'mentions': 3, 'average_position': 4.0, 'net_sentiment': 100.0, 'citations': None,
                'position_gap': 3.0, 'sentiment_gap': 0.0, 'weak': True,
            },
        ]

    def test_takes_the_best_position_and_the_best_sentiment_from_whichever_brand_holds_them(self):
        portfolio = _portfolio({HOTEL: _at(2), SPA: _at(1, 'neutral'), BEACH: _at(4, 'negative')})

        assert _gaps(portfolio) == {HOTEL: (1.0, 0.0, False), SPA: (0.0, 100.0, True), BEACH: (3.0, 200.0, True)}

    @pytest.mark.parametrize('sightings_by_brand', [
        pytest.param({HOTEL: _at(1), SPA: _at(4, times=2)}, id='one_brand_with_three_mentions'),
        pytest.param({HOTEL: _at(1)}, id='one_brand'),
        pytest.param({}, id='no_first_party_brand'),
    ])
    def test_is_empty_unless_two_brands_qualify(self, sightings_by_brand):
        assert _portfolio(sightings_by_brand) == []

    def test_excludes_a_brand_below_three_mentions_and_never_lets_it_set_the_baseline(self):
        portfolio = _portfolio({HOTEL: _at(3), SPA: _at(4), BEACH: _at(1, times=2)})

        assert [(row['name'], row['position_gap']) for row in portfolio] == [(HOTEL, 0.0), (SPA, 1.0)]

    def test_ignores_competitors_however_often_they_are_named(self):
        rows = [*_brand_rows({HOTEL: _at(1), SPA: _at(2)}), *(_answer(f'r{index}', 'openai', _rival()) for index in range(5))]

        assert [row['name'] for row in portfolio_facts(_answers(*rows))] == [HOTEL, SPA]

    def test_marks_a_brand_weak_at_exactly_two_positions_behind(self):
        assert _gaps(_portfolio({HOTEL: _at(1), SPA: _at(3)}))[SPA] == (2.0, 0.0, True)

    def test_marks_a_brand_weak_at_exactly_thirty_sentiment_points_below(self):
        hotel = [(1, 'positive')] * 3 + [(1, 'negative')]
        spa = [(1, 'positive')] * 2 + [(1, 'negative')] + [(1, 'neutral')] * 2

        assert _gaps(_portfolio({HOTEL: hotel, SPA: spa}))[SPA] == (0.0, 30.0, True)

    def test_leaves_a_brand_strong_just_below_both_thresholds(self):
        spa = [(3, 'positive'), (3, 'positive'), (2, 'positive'), (2, 'neutral')]

        assert _gaps(_portfolio({HOTEL: _at(1), SPA: spa}))[SPA] == (1.5, 25.0, False)

    def test_leaves_the_position_gap_empty_for_a_brand_never_ranked(self):
        assert _gaps(_portfolio({HOTEL: _at(1), SPA: _at(None)})) == {HOTEL: (0.0, 0.0, False), SPA: (None, 0.0, False)}

    def test_leaves_the_sentiment_gap_empty_for_a_brand_never_labelled(self):
        assert _gaps(_portfolio({HOTEL: _at(1), SPA: _at(2, None)})) == {HOTEL: (0.0, 0.0, False), SPA: (1.0, None, False)}

    def test_leaves_both_gaps_empty_when_no_brand_has_a_position_or_a_label(self):
        assert _gaps(_portfolio({HOTEL: _at(None, None), SPA: _at(None, None)})) == {HOTEL: (None, None, False), SPA: (None, None, False)}

    def test_keeps_the_leaderboard_order_of_the_brand_table(self):
        assert [row['name'] for row in _portfolio({SPA: _at(3), HOTEL: _at(1)})] == [HOTEL, SPA]

    def test_accepts_a_generator_of_answers(self):
        assert len(portfolio_facts(answer for answer in _answers(*_brand_rows({HOTEL: _at(1), SPA: _at(2)})))) == 2


class TestStabilityFacts:
    def test_measures_one_run_as_a_zero_swing_that_is_not_unstable(self):
        assert stability_facts([_keyword('k', (2.5, None))]) == [
            {'keyword': 'k', 'runs': 1, 'position_min': 2.5, 'position_max': 2.5, 'position_range': 0.0, 'flips': 0, 'unstable': False},
        ]

    @pytest.mark.parametrize(('mention', 'flips', 'unstable'), [('gained', 1, True), ('lost', 1, True), (None, 0, False)])
    def test_counts_a_gained_or_lost_mention_as_a_flip_that_makes_the_keyword_unstable(self, mention, flips, unstable):
        [row] = stability_facts([_keyword('k', (3.0, None), (2.0, mention))])

        assert (row['runs'], row['position_range'], row['flips'], row['unstable']) == (2, 1.0, flips, unstable)

    @pytest.mark.parametrize(('positions', 'position_range', 'unstable'), [
        pytest.param((1.0, 4.0), 3.0, True, id='swing_of_exactly_three'),
        pytest.param((1.0, 3.99), 2.99, False, id='swing_just_below_three'),
        pytest.param((3.67, 4.33), 0.66, False, id='swing_rounded_to_hundredths'),
    ])
    def test_marks_a_keyword_unstable_from_a_swing_of_three_positions(self, positions, position_range, unstable):
        [row] = stability_facts([_keyword('k', *((position, None) for position in positions))])

        assert (row['position_min'], row['position_max'], row['position_range'], row['unstable']) == (*positions, position_range, unstable)

    def test_skips_a_run_without_a_position(self):
        [row] = stability_facts([_keyword('k', (2.0, None), (None, 'lost'), (5.5, 'gained'))])

        assert (row['runs'], row['position_min'], row['position_max'], row['position_range'], row['flips']) == (2, 2.0, 5.5, 3.5, 1)

    def test_never_marks_a_single_positioned_run_unstable_even_when_it_gained_the_brand(self):
        [row] = stability_facts([_keyword('k', (None, None), (2.0, 'gained'))])

        assert (row['runs'], row['flips'], row['unstable']) == (1, 1, False)

    def test_leaves_out_a_keyword_without_a_positioned_run(self):
        assert stability_facts([_keyword('k', (None, None), (None, 'lost')), _keyword('j')]) == []

    def test_keeps_the_keyword_order_of_the_group(self):
        facts = stability_facts([_keyword('b', (1.0, None)), _keyword('a', (2.0, None))])

        assert [row['keyword'] for row in facts] == ['b', 'a']

    def test_reads_the_keyword_history_of_the_group_report(self):
        history = _history({
            'k1': [_answer('k1', 'openai', _sol(1)), _answer('k1', 'openai', _rival(), run=RUN_2), _answer('k1', 'openai', _sol(4), run=RUN_3)],
            'k2': [_answer('k2', 'openai', _sol(2), run=RUN_3)],
        })

        assert stability_facts(history) == [
            {'keyword': 'k1', 'runs': 2, 'position_min': 1.0, 'position_max': 4.0, 'position_range': 3.0, 'flips': 1, 'unstable': True},
            {'keyword': 'k2', 'runs': 1, 'position_min': 2.0, 'position_max': 2.0, 'position_range': 0.0, 'flips': 0, 'unstable': False},
        ]

    def test_is_empty_without_keywords(self):
        assert stability_facts([]) == []


class TestEnginePlayInsights:
    def test_describes_the_play_an_engine_calls_for(self):
        assert derive_insights(_facts(engines=[_engine('openai')])) == [{
            'id': 'engine_play:openai',
            'kind': 'engine_play',
            'severity': 'high',
            'subject': 'openai',
            'evidence': {'top_1_share': 60.0, 'citation_rate': 10.0, 'answers': 10, 'play': 'get_cited'},
            'block': 'insights_engine_playbook',
        }]

    @pytest.mark.parametrize(('answers', 'severity'), [(10, 'high'), (9, 'medium'), (1, 'medium')])
    def test_rates_the_play_high_from_ten_answers(self, answers, severity):
        [insight] = derive_insights(_facts(engines=[_engine('gemini', answers=answers)]))

        assert insight['severity'] == severity

    def test_raises_no_insight_for_an_engine_to_defend(self):
        assert derive_insights(_facts(engines=[_engine('openai', 'defend'), _engine('gemini', 'get_ranked_first')])) == [
            *derive_insights(_facts(engines=[_engine('gemini', 'get_ranked_first')])),
        ]

    def test_carries_an_unknown_citation_rate_as_evidence(self):
        [insight] = derive_insights(_facts(engines=[_engine('claude', 'get_ranked_first', top_1=40.0, cited=None)]))

        assert insight['evidence'] == {'top_1_share': 40.0, 'citation_rate': None, 'answers': 10, 'play': 'get_ranked_first'}


class TestWeakSubbrandInsights:
    def test_describes_a_weak_brand(self):
        assert derive_insights(_facts(portfolio=[_brand(SPA, 2.5, 10.0, mentions=4)])) == [{
            'id': f'weak_subbrand:{SPA}',
            'kind': 'weak_subbrand',
            'severity': 'medium',
            'subject': SPA,
            'evidence': {'mentions': 4, 'average_position': 3.0, 'net_sentiment': 50.0, 'position_gap': 2.5, 'sentiment_gap': 10.0},
            'block': 'insights_brand_portfolio',
        }]

    @pytest.mark.parametrize(('position_gap', 'sentiment_gap', 'severity'), [
        pytest.param(2.0, 30.0, 'high', id='both_gaps_at_their_thresholds'),
        pytest.param(2.0, 29.9, 'medium', id='sentiment_gap_below'),
        pytest.param(1.9, 30.0, 'medium', id='position_gap_below'),
        pytest.param(None, 30.0, 'medium', id='position_gap_unknown'),
    ])
    def test_rates_a_brand_high_only_when_both_gaps_meet_their_thresholds(self, position_gap, sentiment_gap, severity):
        [insight] = derive_insights(_facts(portfolio=[_brand(SPA, position_gap, sentiment_gap)]))

        assert insight['severity'] == severity

    def test_raises_no_insight_for_a_brand_that_is_not_weak(self):
        assert derive_insights(_facts(portfolio=[_brand(HOTEL, 0.0, 0.0, weak=False)])) == []


class TestUnstableKeywordInsights:
    def test_describes_an_unstable_keyword(self):
        assert derive_insights(_facts(stability=[_swing('k1', flips=1, position_range=3.5)])) == [{
            'id': 'unstable_keyword:k1',
            'kind': 'unstable_keyword',
            'severity': 'medium',
            'subject': 'k1',
            'evidence': {'runs': 2, 'position_min': 1.0, 'position_max': 4.5, 'position_range': 3.5, 'flips': 1},
            'block': 'insights_run_stability',
        }]

    @pytest.mark.parametrize(('flips', 'severity'), [(1, 'medium'), (2, 'medium'), (0, 'low')])
    def test_rates_a_flip_medium_and_a_swing_alone_low(self, flips, severity):
        [insight] = derive_insights(_facts(stability=[_swing('k1', flips=flips)]))

        assert insight['severity'] == severity

    def test_raises_no_insight_for_a_stable_keyword(self):
        assert derive_insights(_facts(stability=[_swing('k1', position_range=0.5, unstable=False)])) == []


class TestInsightRanking:
    def test_ranks_by_severity_then_by_the_answers_or_mentions_behind_the_insight(self):
        facts = _facts(
            engines=[_engine('a', answers=5), _engine('c', answers=12)],
            portfolio=[_brand(BEACH, 2.5, 0.0, mentions=7), _brand(SPA, 2.0, 30.0, mentions=3)],
            stability=[_swing('k1')],
        )

        assert _ids(derive_insights(facts)) == [
            'engine_play:c', f'weak_subbrand:{SPA}', f'weak_subbrand:{BEACH}', 'engine_play:a', 'unstable_keyword:k1',
        ]

    def test_keeps_rule_and_fact_order_for_equal_ranks(self):
        facts = _facts(
            engines=[_engine('y', answers=5), _engine('x', answers=5)],
            portfolio=[_brand(SPA, mentions=5), _brand(BEACH, mentions=5)],
            stability=[_swing('k2', flips=1), _swing('k1', flips=1)],
        )

        assert _ids(derive_insights(facts)) == [
            'engine_play:y', 'engine_play:x', f'weak_subbrand:{SPA}', f'weak_subbrand:{BEACH}', 'unstable_keyword:k2', 'unstable_keyword:k1',
        ]

    def test_is_empty_for_empty_facts(self):
        assert derive_insights(_facts()) == []


def _scenario() -> tuple[list[Answer], list[dict[str, Any]]]:
    """The latest answers and the group history of a scope raising one insight of every kind.

    RUN_3 (the latest): three answers rank the hotel 1st and the spa 4th
    (negative), nothing is cited — both engines should get cited, the spa
    trails on position and sentiment. k1's history: hotel 4th in RUN_1,
    lost in RUN_2, back 1st in RUN_3.
    """
    latest = [
        _answer('k1', 'openai', _sol(1), _sol(4, 'negative', SPA), run=RUN_3),
        _answer('k1', 'gemini', _sol(1), _sol(4, 'negative', SPA), run=RUN_3),
        _answer('k2', 'openai', _sol(1), _sol(4, 'negative', SPA), run=RUN_3),
    ]
    earlier = [_answer('k1', 'openai', _sol(4)), _answer('k1', 'openai', _rival(), run=RUN_2)]
    return _answers(*latest), _history({'k1': [*earlier, *latest[:2]], 'k2': latest[2:]})


class TestComputeInsights:
    def test_reports_the_facts_and_the_insights_they_support(self):
        answers, history = _scenario()

        result = compute_insights(answers, OWNED, history)

        assert result['facts'] == {
            'engines': engine_facts(answers, OWNED), 'portfolio': portfolio_facts(answers), 'stability': stability_facts(history),
        }
        assert _ids(result['insights']) == [f'weak_subbrand:{SPA}', 'engine_play:openai', 'engine_play:gemini', 'unstable_keyword:k1']

    @pytest.mark.parametrize('history_keywords', [None, []])
    def test_leaves_stability_empty_outside_a_group(self, history_keywords):
        answers, _history_keywords = _scenario()

        result = compute_insights(answers, OWNED, history_keywords)

        assert (result['facts']['stability'], [insight['kind'] for insight in result['insights'] if insight['kind'] == 'unstable_keyword']) == ([], [])

    def test_reads_a_generator_of_answers_for_every_fact(self):
        answers, _history_keywords = _scenario()

        facts = compute_insights(iter(answers), OWNED)['facts']

        assert (len(facts['engines']), len(facts['portfolio'])) == (2, 2)

    def test_is_empty_without_answers(self):
        assert compute_insights([]) == {'facts': {'engines': [], 'portfolio': [], 'stability': []}, 'insights': []}

    def test_gives_the_same_result_for_the_same_input(self):
        answers, history = _scenario()

        assert compute_insights(answers, OWNED, history) == compute_insights(list(answers), list(OWNED), list(history))

    def test_is_plain_json_without_nan(self):
        answers, history = _scenario()

        assert json.loads(json.dumps(compute_insights(answers, OWNED, history), allow_nan=False)) == compute_insights(answers, OWNED, history)


# ---------------------------------------------------------------------------
# Properties over random scopes: the evidence of every insight is recomputed from
# the KPI engine and the group history, never read back from the facts.
# ---------------------------------------------------------------------------

ENGINES = ('openai', 'gemini', 'claude', 'perplexity')
KEYWORDS = ('k1', 'k2', 'k3')
RUNS = (RUN_1, RUN_2, RUN_3)
CONTRACT_PLAYS = {
    (True, True): 'defend', (True, False): 'get_cited', (False, True): 'get_ranked_first', (False, False): 'get_mentioned_and_cited',
}
CONTRACT_SEVERITY_RANK = {'high': 0, 'medium': 1, 'low': 2}

_RANKS = st.sampled_from([None, 1, 2, 3, 5, 8])
_SENTIMENTS = st.sampled_from(['positive', 'neutral', 'mixed', 'negative', None])
_BRANDS = st.one_of(st.builds(_sol, _RANKS, _SENTIMENTS, st.sampled_from([HOTEL, SPA, BEACH])), st.builds(_rival, _RANKS))
_ROWS = st.lists(
    st.builds(
        search_result_row,
        st.sampled_from(KEYWORDS),
        st.sampled_from(ENGINES),
        st.lists(_BRANDS, max_size=4),
        timestamp=st.sampled_from(RUNS),
        citations=st.lists(st.sampled_from([OWNED_URL, OTHER_URL]), max_size=2),
    ),
    max_size=24,
)


def _scope(rows: list[dict[str, Any]]) -> tuple[list[Answer], list[dict[str, Any]], dict[str, Any]]:
    """The answers of ``rows``, the group history of their keywords, and the insights computed over both."""
    answers = answers_from_rows(rows)
    history = _history({keyword: [row for row in rows if row['keyword'] == keyword] for keyword in KEYWORDS})
    return answers, history, compute_insights(answers, OWNED, history)


def _of_kind(result: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [insight for insight in result['insights'] if insight['kind'] == kind]


def _contract_play(top_1_share: float, citation_rate: float | None) -> str:
    ranked_first = top_1_share >= 50.0
    if citation_rate is None:
        return 'defend' if ranked_first else 'get_ranked_first'
    return CONTRACT_PLAYS[(ranked_first, citation_rate >= 30.0)]


def _contract_engine_evidence(answers: list[Answer], engine: str) -> dict[str, Any]:
    kpis = next(row['kpis'] for row in engine_breakdown(answers, OWNED) if row['engine'] == engine)
    return {
        'top_1_share': kpis['top_1_share'],
        'citation_rate': kpis['citation_rate'],
        'answers': kpis['answers'],
        'play': _contract_play(kpis['top_1_share'], kpis['citation_rate']),
    }


def _contract_brand_evidence(answers: list[Answer], name: str) -> dict[str, Any]:
    peers = [row for row in brand_table(answers) if row['classification'] == 'first_party' and row['mentions'] >= 3]
    row = next(peer for peer in peers if peer['name'] == name)
    positions = [peer['average_position'] for peer in peers if peer['average_position'] is not None]
    sentiments = [peer['net_sentiment'] for peer in peers if peer['net_sentiment'] is not None]
    return {
        'mentions': row['mentions'],
        'average_position': row['average_position'],
        'net_sentiment': row['net_sentiment'],
        'position_gap': None if row['average_position'] is None else round(row['average_position'] - min(positions), 2),
        'sentiment_gap': None if row['net_sentiment'] is None else round(max(sentiments) - row['net_sentiment'], 1),
    }


def _contract_keyword_evidence(history: list[dict[str, Any]], keyword: str) -> dict[str, Any]:
    entry = next(entry for entry in history if entry['keyword'] == keyword)
    runs = [run for run in entry['runs'] if run['kpis']['average_position'] is not None]
    positions = [run['kpis']['average_position'] for run in runs]
    return {
        'runs': len(runs),
        'position_min': min(positions),
        'position_max': max(positions),
        'position_range': round(max(positions) - min(positions), 2),
        'flips': sum(1 for run in runs if run['change'] is not None and run['change']['mention'] in ('gained', 'lost')),
    }


def _contract_rank(insight: dict[str, Any]) -> tuple[int, float]:
    evidence = insight['evidence']
    return CONTRACT_SEVERITY_RANK[insight['severity']], -evidence.get('answers', evidence.get('mentions', 0))


class TestEvidenceProperties:
    @given(_ROWS)
    def test_engine_evidence_repeats_the_engine_breakdown_and_the_contract_play(self, rows):
        answers, _history_keywords, result = _scope(rows)

        for insight in _of_kind(result, 'engine_play'):
            assert insight['evidence'] == _contract_engine_evidence(answers, insight['subject'])

    @given(_ROWS)
    def test_weak_brand_evidence_repeats_the_brand_table_and_the_gaps_to_the_best_peer(self, rows):
        answers, _history_keywords, result = _scope(rows)

        for insight in _of_kind(result, 'weak_subbrand'):
            assert insight['evidence'] == _contract_brand_evidence(answers, insight['subject'])

    @given(_ROWS)
    def test_unstable_keyword_evidence_repeats_the_keyword_history(self, rows):
        _answers_of_rows, history, result = _scope(rows)

        for insight in _of_kind(result, 'unstable_keyword'):
            assert insight['evidence'] == _contract_keyword_evidence(history, insight['subject'])

    @given(_ROWS)
    def test_raises_one_insight_per_flagged_fact_row(self, rows):
        result = _scope(rows)[2]
        facts = result['facts']

        assert {kind: sorted(insight['subject'] for insight in _of_kind(result, kind)) for kind in INSIGHT_KINDS} == {
            'engine_play': sorted(row['engine'] for row in facts['engines'] if row['play'] != 'defend'),
            'weak_subbrand': sorted(row['name'] for row in facts['portfolio'] if row['weak']),
            'unstable_keyword': sorted(row['keyword'] for row in facts['stability'] if row['unstable']),
        }

    @given(_ROWS)
    def test_ranks_insights_by_severity_then_size(self, rows):
        ranks = [_contract_rank(insight) for insight in _scope(rows)[2]['insights']]

        assert ranks == sorted(ranks)

    @given(_ROWS)
    def test_gives_the_same_result_for_the_same_input(self, rows):
        answers, history, result = _scope(rows)

        assert result == compute_insights(answers, OWNED, history)

    @given(_ROWS)
    def test_is_plain_json_without_nan(self, rows):
        result = _scope(rows)[2]

        assert json.loads(json.dumps(result, allow_nan=False)) == result
