"""Tests for a scope's per-run series (``shared.scope_series``): deltas equal a rebuild, bitmaps, and the brand certificate."""

from __future__ import annotations

import functools
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from typing import Any
from unittest.mock import patch

from hypothesis import given, settings
from hypothesis import strategies as st

from shared import scope_series
from shared.kpi_tally import COUNT_FIELDS, BrandTally, RunTally, tally_brand_table, tally_kpis
from shared.scope_series import ScopeSeries, SeriesRow, leaderboard_certificate
from testing.scale_data import ScaleSpec, keyword_text, run_timestamp
from testing.scope_snapshot_fixtures import full_tally

_SPEC = ScaleSpec(keywords=6, personas=1, runs=5, long_tail=12)
_KEYWORDS = range(_SPEC.keywords)
_NO_TRUNCATION = 10_000


_tally = functools.cache(functools.partial(full_tally, _SPEC))


def _rows_without_bitmaps(series: ScopeSeries) -> dict[str, Any]:
    stored = series.to_json(keep_brands=_NO_TRUNCATION, always=())
    rows = {row['t']: {key: value for key, value in row.items() if key != 'bm'} for row in stored['rows']}
    for row in rows.values():
        row['b'] = sorted(row['b'], key=lambda brand: brand[0])
    return rows


def _rebuild(members: set[int], runs: int) -> ScopeSeries:
    series = ScopeSeries('all')
    for keyword in sorted(members):
        for run in range(runs):
            series.add(keyword_text(keyword), _tally(keyword, run))
    return series


_OPERATIONS = st.lists(
    st.one_of(
        st.tuples(st.just('join'), st.sampled_from(list(_KEYWORDS))),
        st.tuples(st.just('leave'), st.sampled_from(list(_KEYWORDS))),
        st.tuples(st.just('run'), st.just(0)),
        st.tuples(st.just('late'), st.sampled_from(list(_KEYWORDS))),
    ),
    max_size=14,
)


def _replay(operations: list[tuple[str, int]]) -> tuple[ScopeSeries, set[int], int]:
    """The series after ``operations`` (stored and reloaded after each, as builds do), its members and the runs so far."""
    series, members, runs = ScopeSeries('all'), {0, 1, 2}, 1
    for keyword in members:
        series.add(keyword_text(keyword), _tally(keyword, 0))
    for name, keyword in operations:
        if name == 'join' and keyword not in members:
            members.add(keyword)
            for run in range(runs):
                series.add(keyword_text(keyword), _tally(keyword, run))
        elif name == 'leave' and keyword in members:
            members.discard(keyword)
            series.remove(keyword_text(keyword), [_tally(keyword, run) for run in range(runs)])
        elif name == 'run' and runs < _SPEC.runs:
            runs += 1
            for member in members:
                series.add(keyword_text(member), _tally(member, runs - 1))
        elif name == 'late' and keyword in members:
            series.add(keyword_text(keyword), _tally(keyword, runs - 1))
        series = ScopeSeries('all', series.to_json(keep_brands=_NO_TRUNCATION, always=()))
    return series, members, runs


class TestDeltas:
    @settings(max_examples=60, deadline=None)
    @given(_OPERATIONS)
    def test_incremental_rows_equal_a_rebuild_after_any_runs_late_writes_joins_and_leaves(self, operations) -> None:
        series, members, runs = _replay(operations)
        assert _rows_without_bitmaps(series) == _rows_without_bitmaps(_rebuild(members, runs))

    @settings(max_examples=60, deadline=None)
    @given(_OPERATIONS)
    def test_bitmaps_hold_only_current_members(self, operations) -> None:
        series, members, _ = _replay(operations)
        counted = {keyword for keyword in _KEYWORDS if series.runs_of(keyword_text(keyword))}
        assert counted <= members

    def test_adding_a_run_twice_counts_it_once(self) -> None:
        series = ScopeSeries('all')
        added = [series.add(keyword_text(0), _tally(0, 0)), series.add(keyword_text(0), _tally(0, 0))]
        assert added == [True, False]

    def test_a_row_pools_like_the_keywords_tallies(self) -> None:
        series = _rebuild({0, 1, 2}, 1)
        pooled = series.rows[run_timestamp(0)].tally()
        tallies = [_tally(keyword, 0) for keyword in (0, 1, 2)]
        assert tally_kpis([pooled])['mention_rate'] == tally_kpis(tallies)['mention_rate']

    def test_a_rows_brand_table_equals_the_keywords_one(self) -> None:
        series = _rebuild({0, 1, 2}, 1)
        pooled = tally_brand_table([series.rows[run_timestamp(0)].tally()])
        pooled_without_keywords = [{key: value for key, value in row.items() if key != 'keywords'} for row in pooled]
        live = [{key: value for key, value in row.items() if key != 'keywords'} for row in tally_brand_table([_tally(k, 0) for k in (0, 1, 2)])]
        assert pooled_without_keywords == live

    def test_a_member_whose_history_lacks_a_run_makes_the_series_dirty(self) -> None:
        series = _rebuild({0, 1}, 2)
        series.remove(keyword_text(0), [_tally(0, 0)])
        assert series.dirty is True

    def test_a_row_round_trips_through_json(self) -> None:
        row = _rebuild({0, 1, 2}, 1).rows[run_timestamp(0)]
        assert SeriesRow.from_json(row.to_json()) == row


# ---------------------------------------------------------------------------
# Certificate
# ---------------------------------------------------------------------------

def _brand_tally(name: str, points: int, mentions: int) -> BrandTally:
    return BrandTally(name, name, 'other', mentions, points, 0, 0, None, (0, 0, 0, 0), ('openai',))


def _synthetic_tally(run: int, brands: Mapping[str, tuple[int, int]]) -> RunTally:
    counts = (1,) + (0,) * (len(COUNT_FIELDS) - 1)
    brand_tallies = tuple(_brand_tally(name, points, mentions) for name, (points, mentions) in sorted(brands.items()))
    return RunTally(keyword='k', timestamp=f'run-{run}', engines={'openai': counts}, brands=brand_tallies, brands_total=len(brands))


_BRAND_NAMES = [f'b{index:02d}' for index in range(14)]
_RUN_BRANDS = st.dictionaries(st.sampled_from(_BRAND_NAMES), st.tuples(st.integers(1, 20), st.integers(1, 5)), max_size=14)


def _truncated_rows(runs: list[dict[str, tuple[int, int]]], keep: int) -> list[SeriesRow]:
    """One row per run, each of one member's synthetic tally, cut to ``keep`` brands."""
    rows = []
    for run, brands in enumerate(runs):
        row = SeriesRow(f'run-{run}')
        row.apply(0, _synthetic_tally(run, brands), 1)
        row.truncate(keep, ())
        rows.append(row)
    return rows


def _certificate_is_sound(rows: list[SeriesRow], answers: list[dict[str, tuple[int, int]]], top: int) -> bool:
    """Whether the certificate over ``rows`` is either inexact or equal to the brute-force top ``top`` of every brand in ``answers``."""
    totals: dict[str, list[int]] = {}
    for brands in answers:
        for name, (points, mentions) in brands.items():
            total = totals.setdefault(name, [0, 0])
            total[0] += points
            total[1] += mentions
    brute = sorted(totals, key=lambda name: (-totals[name][0], -totals[name][1], name))[:top]
    certificate = leaderboard_certificate(rows, top)
    claimed = [(key, points, mentions) for key, _, points, mentions in certificate.brands]
    return not certificate.exact or claimed == [(name, totals[name][0], totals[name][1]) for name in brute]


@contextmanager
def _small_compaction() -> Generator[None]:
    """Rows compact past 4 brands down to 2 for the block."""
    with patch.object(scope_series, 'COMPACT_BRANDS', 4), patch.object(scope_series, 'COMPACT_KEEP', 2):
        yield


class TestCertificate:
    @settings(max_examples=200, deadline=None)
    @given(st.lists(_RUN_BRANDS, min_size=1, max_size=5), st.integers(1, 8), st.integers(1, 5))
    def test_an_exact_certificate_equals_the_brute_force_leaderboard(self, runs, keep, top) -> None:
        assert _certificate_is_sound(_truncated_rows(runs, keep), runs, top) is True

    def test_complete_rows_are_exact(self) -> None:
        series = _rebuild({0, 1, 2, 3}, 3)
        assert leaderboard_certificate(list(series.rows.values())).exact is True

    def test_a_flat_long_tail_cut_hard_is_not_exact(self) -> None:
        rows = _truncated_rows([dict.fromkeys(_BRAND_NAMES, (5, 1))] * 3, 2)
        assert leaderboard_certificate(rows, top=3).exact is False

    def test_adding_to_a_truncated_row_raises_its_threshold(self) -> None:
        row = SeriesRow('run-0')
        row.apply(0, _synthetic_tally(0, {'b00': (10, 1), 'b01': (3, 1)}), 1)
        row.truncate(1, ())
        row.apply(1, _synthetic_tally(0, {'b02': (4, 1)}), 1)
        assert row.threshold == 3 + 4

    @settings(max_examples=150, deadline=None)
    @given(st.lists(st.lists(_RUN_BRANDS, min_size=1, max_size=4), min_size=1, max_size=3), st.integers(1, 5))
    def test_rows_compacted_while_members_are_added_stay_sound(self, runs, top) -> None:
        series = ScopeSeries('all')
        with _small_compaction():
            for run, members in enumerate(runs):
                for member, brands in enumerate(members):
                    series.add(f'k{member}', _synthetic_tally(run, brands))
        answers = [brands for members in runs for brands in members]
        assert _certificate_is_sound(list(series.rows.values()), answers, top) is True

    def test_a_row_past_the_compaction_size_keeps_the_compaction_size(self) -> None:
        series = ScopeSeries('all')
        with _small_compaction():
            series.add('k0', _synthetic_tally(0, {name: (index + 1, 1) for index, name in enumerate(_BRAND_NAMES[:6])}))
        assert sorted(series.rows['run-0'].brands) == ['b04', 'b05']
