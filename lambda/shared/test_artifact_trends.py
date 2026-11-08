"""Tests for shared.artifact_trends: a served trend preset equals the live trend view at the build time."""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from shared.artifact_registry import artifact_builders
from shared.artifact_trends import (
    KEPT_RECENT_DAYS,
    KEYWORD_TRENDS_PAGE,
    PRESET_DAYS,
    TOP_MOVERS,
    TRENDS_BUILDER,
    TrendsParams,
    add_keyword_latest,
    build_clock,
    build_now,
    keyword_runs,
    no_brand_window_exact,
    recent_runs,
    serve_trends,
    trends_brands_key,
    trends_key,
)
from shared.snapshot_artifacts import SnapshotCursor, decode_snapshot_cursor
from shared.visibility_views import LATEST_BRANDS_LIMIT, PERIODS
from testing.kpi_row_strategies import OWNED_DOMAINS, search_rows
from testing.kpi_trends_fixtures import (
    BUILT,
    SCOPE,
    answer_row,
    keyword_tallies,
    offset_pages,
    oracle_trend,
    trend_artifacts,
    trend_doc,
)

PERIOD = st.sampled_from(PERIODS)
DAYS = st.sampled_from(PRESET_DAYS)
#: The served body's fields the live body has too (the snapshot adds the page fields).
_PAGE_FIELDS = (
    'keyword_trends_total', 'keyword_trends_next_token', 'truncated_before', 'keywords_analyzed',
    'latest_brands', 'latest_brands_total', 'latest_brands_next_token', 'top_movers',
)


@settings(max_examples=120, deadline=None)
@given(rows=search_rows(max_size=60), owned=OWNED_DOMAINS, period=PERIOD, days=DAYS)
def test_served_preset_equals_the_live_trend_of_every_run(rows, owned, period, days) -> None:
    served, oracle = _served_and_oracle(keyword_tallies(SCOPE, rows, owned), owned, period, days, 'history')

    assert served == oracle


def _served_and_oracle(tallies, owned, period: str, days: int, block: str) -> tuple[dict, dict]:
    """The served preset and the live trend of the same runs, both without the page fields (``None`` served: ``{}``)."""
    artifacts = trend_artifacts([trend_doc(keyword, tallies[keyword], owned, block=block) for keyword in SCOPE], len(SCOPE), BUILT)
    served = serve_trends(artifacts, TrendsParams(period=period, days=days, page_size=None)) or {'served': None}
    oracle = oracle_trend(SCOPE, tallies, owned, period, days, BUILT)
    return ({key: value for key, value in served.items() if key not in _PAGE_FIELDS}, {key: value for key, value in oracle.items() if key not in _PAGE_FIELDS})


@settings(max_examples=60, deadline=None)
@given(rows=search_rows(max_size=60), owned=OWNED_DOMAINS, period=PERIOD, days=DAYS)
def test_served_body_lists_the_first_brands_of_the_whole_live_leaderboard(rows, owned, period, days) -> None:
    tallies = keyword_tallies(SCOPE, rows, owned)
    artifacts = trend_artifacts([trend_doc(keyword, tallies[keyword], owned) for keyword in SCOPE], len(SCOPE), BUILT)
    whole = oracle_trend(SCOPE, tallies, owned, period, days, BUILT)['latest_brands']

    served = serve_trends(artifacts, TrendsParams(period=period, days=days)) or {}

    assert (served['latest_brands'], served['latest_brands_total']) == (whole[:LATEST_BRANDS_LIMIT], len(whole))


def test_writes_no_preset_whose_runs_lack_their_brands() -> None:
    tallies = keyword_tallies(SCOPE, [answer_row(SCOPE[0], 0)], ())
    docs = [trend_doc(keyword, tallies[keyword], (), block='recent') for keyword in SCOPE]

    assert trend_artifacts(docs, len(SCOPE), BUILT).artifacts == {}


def test_writes_no_preset_longer_than_the_recent_runs_without_a_history() -> None:
    tallies = keyword_tallies(SCOPE, [], ())
    docs = [trend_doc(keyword, tallies[keyword], (), block='tallies') for keyword in SCOPE]

    assert sorted(trend_artifacts(docs, len(SCOPE), BUILT).artifacts) == sorted(
        key for period in PERIODS for days in (7, 30) for key in (trends_key(period, days), trends_brands_key(period, days))
    )


_OLD_AND_NEW_RUNS = ('2026-06-01T06:00:00.000000Z', '2026-08-30T06:00:00.000000Z', '2026-09-20T06:00:00.000000Z', '2026-10-01T06:00:00.000000Z')


def test_keyword_without_history_keeps_only_the_runs_of_the_kept_recent_days() -> None:
    tallies = keyword_tallies(SCOPE, [answer_row(SCOPE[0], index, stamp) for index, stamp in enumerate(_OLD_AND_NEW_RUNS)], ())
    doc = trend_doc(SCOPE[0], tallies[SCOPE[0]], (), block='tallies')

    assert (KEPT_RECENT_DAYS, [run.tally.timestamp for run in keyword_runs(doc)[0]]) == (31, list(_OLD_AND_NEW_RUNS[2:]))


def test_recent_runs_returns_the_same_list_when_every_run_is_recent() -> None:
    tallies = keyword_tallies(SCOPE, [answer_row(SCOPE[0], index, stamp) for index, stamp in enumerate(_OLD_AND_NEW_RUNS[2:])], ())
    runs = keyword_runs(trend_doc(SCOPE[0], tallies[SCOPE[0]], (), block='history'))[0]

    assert recent_runs(runs) is runs


@pytest.mark.parametrize(('period', 'days'), [(period, days) for period in PERIODS for days in (7, 30)])
def test_presets_without_history_equal_the_live_trend_of_every_run_older_ones_included(period, days) -> None:
    rows = [answer_row(keyword, index, stamp) for index, stamp in enumerate(_OLD_AND_NEW_RUNS) for keyword in SCOPE[:3]]
    served, oracle = _served_and_oracle(keyword_tallies(SCOPE, rows, ()), (), period, days, 'tallies')

    assert served == oracle


def test_a_scope_mixing_history_objects_drops_their_old_runs_once_one_object_has_none() -> None:
    tallies = keyword_tallies(SCOPE, [answer_row(SCOPE[0], index, stamp) for index, stamp in enumerate(_OLD_AND_NEW_RUNS)], ())
    acc = add_keyword_latest(None, trend_doc(SCOPE[0], tallies[SCOPE[0]], (), block='history'))
    acc = add_keyword_latest(acc, trend_doc(SCOPE[1], tallies[SCOPE[1]], (), block='tallies'))

    assert [run.tally.timestamp for run in acc.runs[SCOPE[0]]] == list(_OLD_AND_NEW_RUNS[2:])


def test_serves_no_days_that_are_not_a_preset() -> None:
    tallies = keyword_tallies(SCOPE, [], ())
    artifacts = trend_artifacts([trend_doc(keyword, tallies[keyword], ()) for keyword in SCOPE], len(SCOPE), BUILT)

    assert serve_trends(artifacts, TrendsParams(days=45)) is None


def test_one_object_folded_into_two_scopes_is_decoded_once_and_shared() -> None:
    tallies = keyword_tallies(SCOPE, [answer_row(SCOPE[0], 0)], ())
    doc = trend_doc(SCOPE[0], tallies[SCOPE[0]], ())
    first, second = add_keyword_latest(None, doc), add_keyword_latest(None, doc)

    assert first.runs[SCOPE[0]] is second.runs[SCOPE[0]]


def test_another_object_is_decoded_again() -> None:
    tallies = keyword_tallies(SCOPE, [answer_row(SCOPE[0], 0)], ())
    docs = [trend_doc(SCOPE[0], tallies[SCOPE[0]], ()) for _ in range(2)]

    assert keyword_runs(docs[0])[0] is not keyword_runs(docs[1])[0]


class TestKeywordTrendPages:
    KEYWORDS = [f'hotel {index:03}' for index in range(250)]

    def _artifacts(self):
        rows = [answer_row(keyword, index) for index, keyword in enumerate(self.KEYWORDS)]
        tallies = keyword_tallies(self.KEYWORDS, rows, ())
        return trend_artifacts([trend_doc(keyword, tallies[keyword], ()) for keyword in self.KEYWORDS], len(self.KEYWORDS), BUILT)

    def test_concatenated_pages_equal_the_whole_list(self) -> None:
        artifacts = self._artifacts()
        whole = serve_trends(artifacts, TrendsParams(page_size=None)) or {}

        assert offset_pages(lambda offset: serve_trends(artifacts, TrendsParams(view='keyword_trends', offset=offset)), 'keyword_trends') == whole['keyword_trends']

    def test_the_body_holds_the_first_page_and_the_total_with_a_token_of_the_build(self) -> None:
        body = serve_trends(self._artifacts(), TrendsParams()) or {}

        assert (len(body['keyword_trends']), body['keyword_trends_total'], decode_snapshot_cursor(body['keyword_trends_next_token'])) == (
            KEYWORD_TRENDS_PAGE, 250, SnapshotCursor(KEYWORD_TRENDS_PAGE, 'build-0001'),
        )


class TestLatestBrandPages:
    BRANDS = [f'Brand {index:03}' for index in range(130)]

    def _artifacts(self):
        row = {**answer_row(SCOPE[0], 0), 'brands': [
            {'name': name, 'classification': 'competitor', 'rank': index + 1} for index, name in enumerate(self.BRANDS)
        ]}
        tallies = keyword_tallies(SCOPE, [row], ())
        return trend_artifacts([trend_doc(keyword, tallies[keyword], ()) for keyword in SCOPE], len(SCOPE), BUILT)

    def test_pages_from_the_body_token_list_every_brand_of_the_latest_period(self) -> None:
        artifacts = self._artifacts()
        body = serve_trends(artifacts, TrendsParams()) or {}
        cursor = decode_snapshot_cursor(body['latest_brands_next_token'])
        start = cursor.offset if cursor else 0

        rest = offset_pages(lambda offset: serve_trends(artifacts, TrendsParams(view='latest_brands', offset=offset or start)), 'latest_brands')

        assert [row['name'] for row in body['latest_brands'] + rest] == self.BRANDS

    def test_the_body_counts_every_brand_of_the_latest_period(self) -> None:
        body = serve_trends(self._artifacts(), TrendsParams()) or {}

        assert (len(body['latest_brands']), body['latest_brands_total']) == (LATEST_BRANDS_LIMIT, 130)


class TestTopMovers:
    KEYWORDS = [f'hotel {index:03}' for index in range(150)]
    #: Keywords ranked first in both runs (best visibility, unchanged); the rest move from rank 5 to rank 4.
    STEADY = 140

    def _artifacts(self):
        old, new = '2026-09-20T06:00:00.000000Z', '2026-10-01T06:00:00.000000Z'
        rows = [
            row for index, keyword in enumerate(self.KEYWORDS)
            for row in (answer_row(keyword, 4 if index >= self.STEADY else 0, old), answer_row(keyword, 3 if index >= self.STEADY else 0, new))
        ]
        tallies = keyword_tallies(self.KEYWORDS, rows, ())
        return trend_artifacts([trend_doc(keyword, tallies[keyword], ()) for keyword in self.KEYWORDS], len(self.KEYWORDS), BUILT)

    def test_rank_the_improving_keywords_listed_after_the_first_keyword_trends_page(self) -> None:
        body = serve_trends(self._artifacts(), TrendsParams(period='week', days=30)) or {}
        first_page = {row['keyword'] for row in body['keyword_trends']}
        improving = {mover['keyword'] for mover in body['top_movers']['improving']}

        assert (len(improving), improving & first_page, improving <= set(self.KEYWORDS[self.STEADY:])) == (TOP_MOVERS, set(), True)


def test_the_registry_collects_the_trends_builder() -> None:
    assert artifact_builders()['trends'] is TRENDS_BUILDER


def test_window_presets_end_at_the_build_clock_inside_it() -> None:
    with build_clock(BUILT):
        assert build_now() == BUILT


def test_a_brandless_run_in_the_shortest_window_drops_every_brand_tally_inside_a_build() -> None:
    tallies = keyword_tallies(SCOPE, [answer_row(SCOPE[0], 0, '2026-10-01T06:00:00.000000Z')], ())
    doc = trend_doc(SCOPE[0], tallies[SCOPE[0]], (), block='recent')
    with build_clock(BUILT):
        acc = add_keyword_latest(None, doc)
    assert ([run.tally.brands for run in acc.runs[SCOPE[0]]], acc.with_brands) == ([()], False)


def test_outside_a_build_no_window_is_known_to_be_inexact() -> None:
    tallies = keyword_tallies(SCOPE, [answer_row(SCOPE[0], 0, '2026-10-01T06:00:00.000000Z')], ())
    assert no_brand_window_exact(keyword_runs(trend_doc(SCOPE[0], tallies[SCOPE[0]], (), block='recent'))[0]) is False


def test_outside_a_build_the_brand_tallies_are_kept() -> None:
    tallies = keyword_tallies(SCOPE, [answer_row(SCOPE[0], 0, '2026-10-01T06:00:00.000000Z')], ())
    assert add_keyword_latest(None, trend_doc(SCOPE[0], tallies[SCOPE[0]], (), block='recent')).with_brands is True


def test_a_build_that_drops_the_brand_tallies_writes_the_same_presets() -> None:
    rows = [answer_row(keyword, index, stamp) for index, stamp in enumerate(_OLD_AND_NEW_RUNS) for keyword in SCOPE[:3]]
    tallies = keyword_tallies(SCOPE, rows, ())
    docs = [trend_doc(keyword, tallies[keyword], (), block='recent' if keyword == SCOPE[0] else 'tallies') for keyword in SCOPE]
    kept = trend_artifacts(docs, len(SCOPE), BUILT).artifacts
    with build_clock(BUILT):
        dropped = trend_artifacts(docs, len(SCOPE), BUILT).artifacts
    assert dropped == kept
