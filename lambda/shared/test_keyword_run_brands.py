"""Tests for the complete brand lists of capped keyword runs (``shared.keyword_run_brands``)."""

from __future__ import annotations

from shared.keyword_run_brands import (
    brands_from_item,
    brands_item,
    needs_brand_row,
    put_run_brands,
    query_run_brands,
    with_all_brands,
)
from shared.keyword_run_kpis import BRANDS_PER_RUN, run_tally_pair
from shared.kpi_engine import answers_from_rows
from shared.kpi_tally import RunTally
from testing.keyword_run_kpis_fixtures import rollup_table
from testing.scale_data import BRAND_CONFIG, ScaleSpec, keyword_text, run_timestamp, search_result_rows

_WIDE = ScaleSpec(keywords=1, personas=10, long_tail=5_000)
_NARROW = ScaleSpec(keywords=1, personas=0, long_tail=3)


def _pair(spec: ScaleSpec, run: int = 0):
    rows = search_result_rows(spec, 0, run)
    return run_tally_pair(keyword_text(0), run_timestamp(run), answers_from_rows(rows), BRAND_CONFIG)


def _full(spec: ScaleSpec, run: int = 0) -> RunTally:
    return _pair(spec, run).full


class TestTallyPair:
    def test_capped_tally_keeps_the_row_cap(self) -> None:
        assert len(_pair(_WIDE).capped.brands) == BRANDS_PER_RUN

    def test_full_tally_keeps_every_brand(self) -> None:
        full = _full(_WIDE)
        assert len(full.brands) == full.brands_total

    def test_a_run_within_the_cap_is_one_tally(self) -> None:
        pair = _pair(_NARROW)
        assert pair.full is pair.capped


class TestRows:
    def test_a_capped_run_needs_a_brand_row(self) -> None:
        assert needs_brand_row(_full(_WIDE)) is True

    def test_a_run_within_the_cap_needs_none(self) -> None:
        assert needs_brand_row(_full(_NARROW)) is False

    def test_a_row_round_trips_every_brand(self) -> None:
        full = _full(_WIDE)
        assert brands_from_item(brands_item(full)) == full.brands

    def test_a_row_of_another_format_reads_as_none(self) -> None:
        assert brands_from_item({**brands_item(_full(_WIDE)), 'v': 99}) is None

    def test_a_malformed_row_reads_as_none(self) -> None:
        assert brands_from_item({**brands_item(_full(_WIDE)), 'brands': '{"p": []}'}) is None


class TestWritesAndReads:
    def test_writes_only_capped_runs(self) -> None:
        stored: dict = {}
        table = rollup_table(stored)
        written = [put_run_brands(table, _full(_WIDE)), put_run_brands(table, _full(_NARROW, 1))]
        assert (written, len(stored[keyword_text(0)])) == ([True, False], 1)

    def test_reads_the_runs_of_a_window_by_timestamp(self) -> None:
        table = rollup_table({})
        for run in range(3):
            put_run_brands(table, _full(_WIDE, run))
        assert sorted(query_run_brands(table, keyword_text(0), run_timestamp(1))) == [run_timestamp(1), run_timestamp(2)]

    def test_a_capped_tally_gets_every_brand_of_its_run(self) -> None:
        pair = _pair(_WIDE)
        table = rollup_table({})
        put_run_brands(table, pair.full)
        assert with_all_brands(pair.capped, query_run_brands(table, keyword_text(0), run_timestamp(0))) == pair.full

    def test_a_tally_without_a_brand_row_is_unchanged(self) -> None:
        pair = _pair(_NARROW)
        assert with_all_brands(pair.capped, {}) is pair.capped
