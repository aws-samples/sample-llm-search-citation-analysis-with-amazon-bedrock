"""Tests for shared/insights_engine.py — the facts and insights behind the Insights report."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from shared.group_kpi_history import build_group_kpi_history
from shared.insights_citations import citation_ownership_facts, owned_pages_facts
from shared.insights_engine import (
    BLOCK_BY_KIND,
    CAVEAT_HIGH_SHARE,
    CAVEAT_MAX_REASONS,
    CAVEAT_MIN_MENTIONS,
    CAVEAT_SHARE_MIN,
    ENGINE_CITED_MIN,
    ENGINE_TOP1_MIN,
    INSIGHT_KINDS,
    LEAD_HIGH_MIN_CITATIONS,
    LEAD_HIGH_RATIO,
    PROMPT_ENGINE_MAX_KEYWORDS,
    PROMPT_TOP_POSITION,
    SUBBRAND_MIN_MENTIONS,
    SUBBRAND_POSITION_GAP,
    SUBBRAND_SENTIMENT_GAP,
    UNSTABLE_POSITION_RANGE,
    competitor_caveat_facts,
    compute_insights,
    derive_insights,
    engine_facts,
    portfolio_facts,
    prompt_engine_facts,
    stability_facts,
)
from shared.kpi_engine import KPI_IDS, Answer, answers_from_rows, brand_kpis, brand_table, engine_breakdown
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
OWNED_DOC_URL = 'https://hotel-sol.com/files/annual-report.pdf'
RIVAL_URL = 'https://hotel-mar.com/offers'
RIVAL_DOMAINS = {RIVAL: ['hotel-mar.com']}

#: One brand sighting: its rank and sentiment label.
Sighting = tuple[int | None, str | None]
#: One run of a keyword's history: the brand's average position and its mention change since the previous run.
RunPoint = tuple[float | None, str | None]


def _answer(
    keyword: str, provider: str, *brands: dict[str, Any], run: str = RUN_1, cites: Iterable[str] = (), query_prompt_id: str = 'default',
) -> dict[str, Any]:
    """One stored answer of ``provider`` to ``keyword`` (as persona ``query_prompt_id``) in ``run``, naming ``brands`` and citing ``cites``."""
    return search_result_row(keyword, provider, brands, timestamp=run, citations=list(cites), query_prompt_id=query_prompt_id)


def _sol(rank: int | None = 1, sentiment: str | None = 'positive', name: str = HOTEL) -> dict[str, Any]:
    """A first-party brand (the hotel by default) seen at ``rank`` with ``sentiment``."""
    return stored_brand(name, sentiment, rank=rank)


def _rival(rank: int | None = 1, sentiment: str | None = None, reason: str | None = None) -> dict[str, Any]:
    """The competitor seen at ``rank``, worded ``sentiment`` for ``reason``."""
    return stored_brand(RIVAL, sentiment, classification='competitor', rank=rank, sentiment_reason=reason)


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
    **phase_2: Any,
) -> dict[str, Any]:
    """Facts holding the given rows; ``phase_2`` replaces the prompt, citation and caveat facts, empty by default."""
    return {
        'engines': list(engines),
        'prompt_engine': {'engines': [], 'keywords': [], 'omitted': 0},
        'citation_ownership': {'owned_configured': True, 'competitors_configured': True, 'engines': []},
        'owned_pages': {'pages': [], 'pages_omitted': 0, 'sections': [], 'engines': [], 'document_citations': 0, 'page_citations': 0},
        'competitor_caveats': [],
        'portfolio': list(portfolio),
        'stability': list(stability),
        **phase_2,
    }


def _ids(insights: list[dict[str, Any]]) -> list[str]:
    return [insight['id'] for insight in insights]


class TestThresholds:
    def test_pins_the_thresholds_of_the_contract(self):
        assert (ENGINE_TOP1_MIN, ENGINE_CITED_MIN, SUBBRAND_MIN_MENTIONS, SUBBRAND_POSITION_GAP, SUBBRAND_SENTIMENT_GAP, UNSTABLE_POSITION_RANGE) == (
            50.0, 30.0, 3, 2.0, 30.0, 3.0,
        )

    def test_pins_the_thresholds_of_the_phase_2_rules(self):
        assert (
            CAVEAT_SHARE_MIN, CAVEAT_MIN_MENTIONS, CAVEAT_HIGH_SHARE, CAVEAT_MAX_REASONS,
            PROMPT_TOP_POSITION, PROMPT_ENGINE_MAX_KEYWORDS, LEAD_HIGH_RATIO, LEAD_HIGH_MIN_CITATIONS,
        ) == (30.0, 5, 50.0, 3, 3, 50, 2.0, 10)

    def test_names_a_report_block_for_every_kind_in_rule_order(self):
        assert (INSIGHT_KINDS, BLOCK_BY_KIND) == (
            ('engine_play', 'weak_subbrand', 'unstable_keyword', 'competitor_sites', 'documents_cited', 'competitor_caveat', 'prompt_gap'),
            {
                'engine_play': 'insights_engine_playbook',
                'weak_subbrand': 'insights_brand_portfolio',
                'unstable_keyword': 'insights_run_stability',
                'competitor_sites': 'insights_citation_ownership',
                'documents_cited': 'insights_owned_pages',
                'competitor_caveat': 'insights_competitor_caveats',
                'prompt_gap': 'insights_prompt_engine',
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


class TestPromptEngineFacts:
    def test_gives_each_keyword_the_best_position_per_engine_and_the_engines_it_loses(self):
        answers = _answers(
            _answer('k1', 'openai', _sol(4)), _answer('k1', 'openai', _sol(2), query_prompt_id='family'),
            _answer('k1', 'gemini', _rival()),
        )

        assert prompt_engine_facts(answers) == {
            'engines': ['gemini', 'openai'],
            'keywords': [{'keyword': 'k1', 'visibility_score': 54.3, 'positions': {'gemini': None, 'openai': 2}, 'lost_engines': ['gemini']}],
            'omitted': 0,
        }

    @pytest.mark.parametrize(('rank', 'lost'), [(3, []), (4, ['openai']), (None, ['openai'])])
    def test_loses_an_engine_placing_the_brand_below_third_or_at_no_known_position(self, rank, lost):
        [row] = prompt_engine_facts(_answers(_answer('k1', 'openai', _sol(rank))))['keywords']

        assert row['lost_engines'] == lost

    def test_lists_the_lowest_visibility_score_first(self):
        answers = _answers(_answer('strong', 'openai', _sol(1)), _answer('weak', 'openai', _sol(5)), _answer('absent', 'openai', _rival()))

        assert [row['keyword'] for row in prompt_engine_facts(answers)['keywords']] == ['absent', 'weak', 'strong']

    def test_keeps_the_fifty_weakest_keywords_and_counts_the_rest(self):
        answers = _answers(*(_answer(f'k{index:02}', 'openai', _sol(1 if index < 2 else 8)) for index in range(PROMPT_ENGINE_MAX_KEYWORDS + 2)))

        facts = prompt_engine_facts(answers)

        assert (len(facts['keywords']), facts['omitted'], {row['keyword'] for row in facts['keywords']} & {'k00', 'k01'}) == (50, 2, set())

    def test_is_empty_without_answers(self):
        assert prompt_engine_facts([]) == {'engines': [], 'keywords': [], 'omitted': 0}


class TestCompetitorCaveatFacts:
    def test_counts_the_mixed_and_negative_mentions_of_each_competitor_with_their_reasons(self):
        answers = _answers(
            _answer('k1', 'openai', _rival(sentiment='mixed', reason='Fees add up')),
            _answer('k2', 'openai', _rival(sentiment='negative', reason='Late check-in')),
            _answer('k3', 'openai', _rival(sentiment='positive', reason='Great pool')),
            _answer('k4', 'gemini', _rival(sentiment='mixed', reason='Fees add up')),
        )

        assert competitor_caveat_facts(answers) == [
            {'name': RIVAL, 'mentions': 4, 'mixed': 2, 'negative': 1, 'caveat_share': 75.0, 'reasons': ['Fees add up', 'Late check-in']},
        ]

    def test_lists_at_most_three_reasons_in_answer_order(self):
        answers = _answers(*(_answer(f'k{index}', 'openai', _rival(sentiment='negative', reason=f'reason {index}')) for index in range(5)))

        assert competitor_caveat_facts(answers)[0]['reasons'] == ['reason 0', 'reason 1', 'reason 2']

    def test_leaves_the_reasons_empty_when_none_is_stored(self):
        [row] = competitor_caveat_facts(_answers(_answer('k1', 'openai', _rival(sentiment='mixed'))))

        assert (row['caveat_share'], row['reasons']) == (100.0, [])

    def test_ignores_first_party_brands_and_lists_the_most_mentioned_competitor_first(self):
        other = stored_brand('Casa Luna', 'negative', classification='competitor')
        answers = _answers(_answer('k1', 'openai', _sol(1, 'negative'), other), _answer('k2', 'openai', _rival(), other))

        assert [(row['name'], row['mentions']) for row in competitor_caveat_facts(answers)] == [('Casa Luna', 2), (RIVAL, 1)]


def _ownership(*rows: dict[str, Any], owned: bool = True, competitors: bool = True) -> dict[str, Any]:
    return {'owned_configured': owned, 'competitors_configured': competitors, 'engines': list(rows)}


def _ownership_row(engine: str, owned: int, answers: int = 10, **competitors: int) -> dict[str, Any]:
    return {'engine': engine, 'answers': answers, 'citations': owned + sum(competitors.values()), 'owned': owned, 'competitors': competitors, 'third_party': 0}


class TestCompetitorSitesInsights:
    def test_names_the_engine_the_most_cited_competitor_and_both_counts(self):
        facts = _facts(citation_ownership=_ownership(_ownership_row('openai', 28, mar=33, sky=52)))

        assert derive_insights(facts) == [{
            'id': 'competitor_sites:openai',
            'kind': 'competitor_sites',
            'severity': 'medium',
            'subject': 'openai',
            'evidence': {'competitor': 'sky', 'competitor_citations': 52, 'owned_citations': 28, 'answers': 10},
            'block': 'insights_citation_ownership',
        }]

    @pytest.mark.parametrize(('owned', 'competitor', 'severity'), [
        pytest.param(5, 10, 'high', id='twice_the_owned_count_at_ten'),
        pytest.param(5, 9, 'medium', id='under_twice'),
        pytest.param(0, 9, 'medium', id='under_ten_citations'),
    ])
    def test_rates_a_lead_high_at_twice_the_owned_count_and_ten_citations(self, owned, competitor, severity):
        [insight] = derive_insights(_facts(citation_ownership=_ownership(_ownership_row('gemini', owned, mar=competitor))))

        assert insight['severity'] == severity

    def test_raises_nothing_while_the_owned_domains_are_cited_as_often(self):
        assert derive_insights(_facts(citation_ownership=_ownership(_ownership_row('openai', 7, mar=7)))) == []

    @pytest.mark.parametrize(('owned', 'competitors'), [(False, True), (True, False)])
    def test_raises_nothing_without_owned_or_competitor_domains(self, owned, competitors):
        ownership = _ownership(_ownership_row('openai', 0, mar=7), owned=owned, competitors=competitors)

        assert derive_insights(_facts(citation_ownership=ownership)) == []


def _owned_pages(*engines: tuple[str, int, int]) -> dict[str, Any]:
    rows = [{'engine': engine, 'document_citations': documents, 'page_citations': pages} for engine, documents, pages in engines]
    return {'pages': [], 'pages_omitted': 0, 'sections': [], 'engines': rows, 'document_citations': 0, 'page_citations': 0}


class TestDocumentsCitedInsights:
    def test_names_the_engine_citing_more_documents_than_pages_with_both_counts(self):
        assert derive_insights(_facts(owned_pages=_owned_pages(('openai', 36, 32), ('gemini', 3, 3)))) == [{
            'id': 'documents_cited:openai',
            'kind': 'documents_cited',
            'severity': 'medium',
            'subject': 'openai',
            'evidence': {'document_citations': 36, 'page_citations': 32},
            'block': 'insights_owned_pages',
        }]

    def test_rates_documents_high_at_twice_the_pages_and_ten_citations(self):
        [insight] = derive_insights(_facts(owned_pages=_owned_pages(('claude', 10, 5))))

        assert insight['severity'] == 'high'


def _caveat(name: str = RIVAL, mentions: int = 5, caveat_share: float | None = 30.0) -> dict[str, Any]:
    return {'name': name, 'mentions': mentions, 'mixed': 1, 'negative': 1, 'caveat_share': caveat_share, 'reasons': ['Fees add up']}


class TestCompetitorCaveatInsights:
    def test_describes_the_caveats_of_a_competitor(self):
        assert derive_insights(_facts(competitor_caveats=[_caveat()])) == [{
            'id': f'competitor_caveat:{RIVAL}',
            'kind': 'competitor_caveat',
            'severity': 'medium',
            'subject': RIVAL,
            'evidence': {'mentions': 5, 'mixed': 1, 'negative': 1, 'caveat_share': 30.0},
            'block': 'insights_competitor_caveats',
        }]

    @pytest.mark.parametrize(('mentions', 'caveat_share', 'raised'), [
        pytest.param(5, 30.0, True, id='both_at_their_thresholds'),
        pytest.param(4, 100.0, False, id='four_mentions'),
        pytest.param(5, 29.9, False, id='share_below_thirty'),
    ])
    def test_needs_five_mentions_and_a_thirty_percent_caveat_share(self, mentions, caveat_share, raised):
        assert bool(derive_insights(_facts(competitor_caveats=[_caveat(mentions=mentions, caveat_share=caveat_share)]))) is raised

    @pytest.mark.parametrize(('caveat_share', 'severity'), [(50.0, 'high'), (49.9, 'medium')])
    def test_rates_a_caveat_share_of_half_the_mentions_high(self, caveat_share, severity):
        [insight] = derive_insights(_facts(competitor_caveats=[_caveat(caveat_share=caveat_share)]))

        assert insight['severity'] == severity


def _prompt_row(keyword: str, **positions: int | None) -> dict[str, Any]:
    lost = [engine for engine, position in positions.items() if position is None or position > 3]
    return {'keyword': keyword, 'visibility_score': 12.5, 'positions': positions, 'lost_engines': lost}


class TestPromptGapInsights:
    def test_describes_a_keyword_every_engine_loses(self):
        facts = _facts(prompt_engine={'engines': ['gemini', 'openai'], 'keywords': [_prompt_row('k1', gemini=None, openai=5)], 'omitted': 0})

        assert derive_insights(facts) == [{
            'id': 'prompt_gap:k1',
            'kind': 'prompt_gap',
            'severity': 'low',
            'subject': 'k1',
            'evidence': {'engines': 2, 'named_engines': 1, 'best_position': 5, 'visibility_score': 12.5},
            'block': 'insights_prompt_engine',
        }]

    def test_rates_a_keyword_no_engine_names_the_brand_on_medium(self):
        facts = _facts(prompt_engine={'engines': ['openai'], 'keywords': [_prompt_row('k1', openai=None)], 'omitted': 0})

        assert [(insight['severity'], insight['evidence']['best_position']) for insight in derive_insights(facts)] == [('medium', None)]

    def test_raises_nothing_while_one_engine_places_the_brand_in_the_top_three(self):
        facts = _facts(prompt_engine={'engines': ['gemini', 'openai'], 'keywords': [_prompt_row('k1', gemini=None, openai=3)], 'omitted': 0})

        assert derive_insights(facts) == []


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
            'engines': engine_facts(answers, OWNED),
            'prompt_engine': prompt_engine_facts(answers),
            'citation_ownership': citation_ownership_facts(answers, OWNED),
            'owned_pages': owned_pages_facts(answers, OWNED),
            'competitor_caveats': competitor_caveat_facts(answers),
            'portfolio': portfolio_facts(answers),
            'stability': stability_facts(history),
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
        assert compute_insights([]) == {'facts': _facts(citation_ownership={'owned_configured': False, 'competitors_configured': False, 'engines': []}), 'insights': []}

    def test_splits_the_citations_by_the_competitor_domains_it_is_given(self):
        answers = _answers(_answer('k1', 'openai', _sol(), cites=[OWNED_URL, RIVAL_URL]))

        ownership = compute_insights(answers, OWNED, competitor_domains=RIVAL_DOMAINS)['facts']['citation_ownership']

        assert (ownership['competitors_configured'], ownership['engines'][0]['competitors']) == (True, {RIVAL: 1})

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
_REASONS = st.sampled_from([None, 'Fees add up', 'Late check-in', 'Small rooms', 'Noisy bar'])
_BRANDS = st.one_of(st.builds(_sol, _RANKS, _SENTIMENTS, st.sampled_from([HOTEL, SPA, BEACH])), st.builds(_rival, _RANKS, _SENTIMENTS, _REASONS))
_ROWS = st.lists(
    st.builds(
        search_result_row,
        st.sampled_from(KEYWORDS),
        st.sampled_from(ENGINES),
        st.lists(_BRANDS, max_size=4),
        timestamp=st.sampled_from(RUNS),
        citations=st.lists(st.sampled_from([OWNED_URL, OTHER_URL, OWNED_DOC_URL, RIVAL_URL]), max_size=4),
    ),
    max_size=24,
)


def _scope(rows: list[dict[str, Any]]) -> tuple[list[Answer], list[dict[str, Any]], dict[str, Any]]:
    """The answers of ``rows``, the group history of their keywords, and the insights computed over both."""
    answers = answers_from_rows(rows)
    history = _history({keyword: [row for row in rows if row['keyword'] == keyword] for keyword in KEYWORDS})
    return answers, history, compute_insights(answers, OWNED, history, RIVAL_DOMAINS)


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


def _citing(answers: list[Answer], engine: str, *urls: str) -> int:
    """The (answer, URL) pairs of ``engine`` citing one of ``urls``."""
    return sum(url in answer.cited_urls for answer in answers if answer.provider == engine for url in urls)


def _contract_competitor_sites_evidence(answers: list[Answer], engine: str) -> dict[str, Any]:
    return {
        'competitor': RIVAL,
        'competitor_citations': _citing(answers, engine, RIVAL_URL),
        'owned_citations': _citing(answers, engine, OWNED_URL, OWNED_DOC_URL),
        'answers': sum(answer.provider == engine for answer in answers),
    }


def _contract_documents_evidence(answers: list[Answer], engine: str) -> dict[str, Any]:
    return {'document_citations': _citing(answers, engine, OWNED_DOC_URL), 'page_citations': _citing(answers, engine, OWNED_URL)}


def _contract_caveat_evidence(answers: list[Answer], name: str) -> dict[str, Any]:
    labels = [sighting.sentiment for answer in answers for sighting in answer.sightings if sighting.name == name]
    caveats = labels.count('mixed') + labels.count('negative')
    return {
        'mentions': len(labels),
        'mixed': labels.count('mixed'),
        'negative': labels.count('negative'),
        'caveat_share': round(caveats / len(labels) * 100, 1),
    }


def _contract_prompt_gap_evidence(answers: list[Answer], keyword: str) -> dict[str, Any]:
    pool = [answer for answer in answers if answer.keyword == keyword]
    engines = {answer.provider for answer in pool}
    ranks = {engine: [rank for answer in pool if answer.provider == engine and (rank := answer.best_first_party_rank()) is not None] for engine in engines}
    named = [min(found) for found in ranks.values() if found]
    return {
        'engines': len(engines),
        'named_engines': len(named),
        'best_position': min(named, default=None),
        'visibility_score': brand_kpis(pool)['visibility_score'],
    }


#: Each kind's contract evidence, recomputed from the scope's answers.
CONTRACT_ANSWER_EVIDENCE = {
    'engine_play': _contract_engine_evidence,
    'weak_subbrand': _contract_brand_evidence,
    'competitor_sites': _contract_competitor_sites_evidence,
    'documents_cited': _contract_documents_evidence,
    'competitor_caveat': _contract_caveat_evidence,
    'prompt_gap': _contract_prompt_gap_evidence,
}


def _contract_rank(insight: dict[str, Any]) -> tuple[int, float]:
    evidence = insight['evidence']
    return CONTRACT_SEVERITY_RANK[insight['severity']], -evidence.get('answers', evidence.get('mentions', 0))


class TestEvidenceProperties:
    @pytest.mark.parametrize('kind', list(CONTRACT_ANSWER_EVIDENCE))
    @given(rows=_ROWS)
    def test_evidence_recomputes_from_the_answers_of_the_scope(self, kind, rows):
        answers, _history_keywords, result = _scope(rows)

        for insight in _of_kind(result, kind):
            assert insight['evidence'] == CONTRACT_ANSWER_EVIDENCE[kind](answers, insight['subject'])

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
            'competitor_sites': sorted(
                row['engine'] for row in facts['citation_ownership']['engines'] if row['competitors'][RIVAL] > row['owned']
            ),
            'documents_cited': sorted(row['engine'] for row in facts['owned_pages']['engines'] if row['document_citations'] > row['page_citations']),
            'competitor_caveat': sorted(
                row['name'] for row in facts['competitor_caveats'] if row['mentions'] >= 5 and (row['caveat_share'] or 0) >= 30.0
            ),
            'prompt_gap': sorted(
                row['keyword'] for row in facts['prompt_engine']['keywords']
                if all(position is None or position > 3 for position in row['positions'].values())
            ),
        }

    @given(_ROWS)
    def test_ranks_insights_by_severity_then_size(self, rows):
        ranks = [_contract_rank(insight) for insight in _scope(rows)[2]['insights']]

        assert ranks == sorted(ranks)

    @given(_ROWS)
    def test_gives_the_same_result_for_the_same_input(self, rows):
        answers, history, result = _scope(rows)

        assert result == compute_insights(answers, OWNED, history, RIVAL_DOMAINS)

    @given(_ROWS)
    def test_is_plain_json_without_nan(self, rows):
        result = _scope(rows)[2]

        assert json.loads(json.dumps(result, allow_nan=False)) == result
