"""Tests for testing.scale_data: the generated tenant is deterministic, sized as asked and readable by the real code."""

from __future__ import annotations

import itertools

from shared.keyword_run_kpis import tally_from_item
from shared.kpi_engine import answers_from_rows
from shared.markets import validate_market
from testing.scale_data import (
    FIRST_PARTY,
    TEN_X,
    ScaleSpec,
    group_items,
    group_members,
    iter_keyword_run_kpis,
    iter_search_results,
    keyword_items,
    keyword_run_kpis_item,
    market_items,
    persona_ids,
    run_timestamps,
    search_result_rows,
)

SMALL = ScaleSpec()


def test_rows_are_identical_on_every_call() -> None:
    assert search_result_rows(SMALL, 7, 2) == search_result_rows(SMALL, 7, 2)


def test_a_run_holds_one_answer_per_persona_and_engine() -> None:
    rows = search_result_rows(SMALL, 0, 0)

    assert sorted((row['query_prompt_id'], row['provider']) for row in rows) == sorted(
        itertools.product(persona_ids(SMALL), SMALL.engines),
    )


def test_every_row_is_an_answer_the_kpi_engine_reads() -> None:
    rows = search_result_rows(SMALL, 3, 1)

    assert len(answers_from_rows(rows)) == len(rows)


def test_the_first_party_is_named_in_most_answers() -> None:
    rows = [row for keyword in range(SMALL.keywords) for row in search_result_rows(SMALL, keyword, 0)]
    named = sum(any(brand['name'] == FIRST_PARTY for brand in row['brands']) for row in rows)

    assert 0.6 * len(rows) < named < len(rows)


def test_no_persona_enabled_asks_the_plain_keyword() -> None:
    assert persona_ids(ScaleSpec(personas=0)) == ('default',)


def test_keyword_run_kpis_rows_decode_to_the_run_tally() -> None:
    tally = tally_from_item(keyword_run_kpis_item(SMALL, 5, 2))

    assert tally is not None
    assert (tally.timestamp, tally.answers) == (run_timestamps(SMALL)[2], SMALL.personas * len(SMALL.engines))


def test_iterators_yield_every_keyword_run_lazily() -> None:
    spec = ScaleSpec(keywords=3, runs=2, personas=1)

    assert (sum(1 for _ in iter_search_results(spec)), sum(1 for _ in iter_keyword_run_kpis(spec))) == (3 * 2 * 4, 3 * 2)


def test_markets_are_valid_market_definitions() -> None:
    assert [validate_market(market)[1] for market in market_items(SMALL)] == [None] * SMALL.markets


def test_keywords_spread_over_the_markets() -> None:
    assert len({item['market_id'] for item in keyword_items(SMALL)}) == SMALL.markets


def test_group_zero_is_the_largest_group() -> None:
    sizes = [len(group_members(TEN_X, index)) for index in range(TEN_X.groups)]

    assert (sizes[0], max(sizes), len(group_items(TEN_X))) == (160, 160, 710)


def test_group_membership_matches_the_keyword_rows() -> None:
    members = {index % SMALL.keywords for index in group_members(SMALL, 0)}
    tagged = {index for index, item in enumerate(keyword_items(SMALL)) if 'group-0000' in item.get('group_ids', set())}

    assert tagged == members


def test_ten_x_is_the_design_point() -> None:
    assert (TEN_X.keywords, TEN_X.personas * len(TEN_X.engines), TEN_X.runs, TEN_X.markets) == (5000, 40, 365, 15)


def test_ten_x_keyword_rows_have_unique_texts() -> None:
    items = keyword_items(TEN_X)

    assert len({item['keyword'] for item in items}) == 5000
