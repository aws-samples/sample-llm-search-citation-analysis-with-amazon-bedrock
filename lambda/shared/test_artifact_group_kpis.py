"""Tests for shared.artifact_group_kpis: a served group-kpis preset equals the live summary and drivers at the build time."""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from shared.answer_queries import history_since
from shared.artifact_group_kpis import (
    GROUP_KPIS_BUILDER,
    SUMMARY_KEYWORDS_PAGE,
    GroupKpisParams,
    drivers_page,
    group_kpis_artifacts,
    serve_group_kpis,
    summary_fields,
    window_summary,
)
from shared.artifact_registry import artifact_builders
from shared.artifact_trends import PRESET_DAYS
from shared.group_kpi_history import group_kpi_history_from_runs, keyword_summary, run_drivers, summary_run
from testing.kpi_row_strategies import OWNED_DOMAINS, search_rows
from testing.kpi_trends_fixtures import BUILT, SCOPE, SCOPE_ALL, answer_row, keyword_tallies, offset_pages, trend_doc
from testing.snapshot_fakes import FakeSnapshotArtifacts

DAYS = st.sampled_from(PRESET_DAYS)


def stub_build(docs, keywords_total: int) -> FakeSnapshotArtifacts:
    """The ``group-kpis`` artifacts of ``docs`` built at ``BUILT``, as a stored build."""
    acc = None
    for doc in docs:
        acc = GROUP_KPIS_BUILDER.fold(acc, doc, SCOPE_ALL)
    return FakeSnapshotArtifacts(group_kpis_artifacts(acc, BUILT), keywords_total=keywords_total)


def stub_served_and_live(rows, owned, days, view):
    """The ``view`` of the ``days`` preset built from ``rows``, and the live summary over the same window (the oracle)."""
    tallies = keyword_tallies(SCOPE, rows, owned)
    artifacts = stub_build([trend_doc(keyword, tallies[keyword], owned) for keyword in SCOPE], len(SCOPE))
    since = history_since(days, BUILT)
    window = {keyword: [tally for tally in tallies[keyword] if tally.timestamp >= since] for keyword in SCOPE}
    served = serve_group_kpis(artifacts, GroupKpisParams(days=days, view=view)) or {}
    return served, {'since': since, **window_summary(SCOPE, window, list(owned))}


#: What each view of a preset must equal: the live summary's fields, or the live drivers' first page.
_LIVE_VIEW = {
    'summary': lambda live: {'since': live['since'], **summary_fields(live['runs'], live['keywords'])},
    'drivers': lambda live: {'changes': drivers_page(live['drivers'], None, None)['changes']},
}


@pytest.mark.parametrize('view', list(_LIVE_VIEW))
@settings(max_examples=100, deadline=None)
@given(rows=search_rows(max_size=60), owned=OWNED_DOMAINS, days=DAYS)
def test_served_view_equals_the_live_view_of_every_run(view, rows, owned, days) -> None:
    served, live = stub_served_and_live(rows, owned, days, view)
    expected = _LIVE_VIEW[view](live)

    assert {key: served[key] for key in expected} == expected


@settings(max_examples=100, deadline=None)
@given(rows=search_rows(max_size=60), owned=OWNED_DOMAINS)
def test_window_summary_equals_the_whole_group_history_summarized(rows, owned) -> None:
    tallies = keyword_tallies(SCOPE, rows, owned)
    history = group_kpi_history_from_runs(SCOPE, tallies, list(owned))

    assert window_summary(SCOPE, tallies, list(owned)) == {
        'runs': [summary_run(run) for run in history['runs']],
        'keywords': [keyword_summary(entry) for entry in history['keywords']],
        'drivers': run_drivers(history['runs']),
    }


def test_accumulator_holds_the_runs_without_their_brand_tallies() -> None:
    tallies = keyword_tallies(SCOPE, [answer_row(SCOPE[0], 0)], ())
    acc = GROUP_KPIS_BUILDER.fold(None, trend_doc(SCOPE[0], tallies[SCOPE[0]], ()), SCOPE_ALL)

    assert ([run.tally.brands for run in acc.runs[SCOPE[0]]], [run.has_brands for run in acc.runs[SCOPE[0]]]) == ([()], [True])


def test_writes_the_presets_the_recent_runs_cover_without_a_history() -> None:
    tallies = keyword_tallies(SCOPE, [answer_row(SCOPE[0], 0)], ())
    artifacts = stub_build([trend_doc(keyword, tallies[keyword], (), block='recent') for keyword in SCOPE], len(SCOPE))

    assert sorted(artifacts.artifacts) == ['group-kpis/30', 'group-kpis/7']


def test_serves_no_days_that_are_not_a_preset() -> None:
    tallies = keyword_tallies(SCOPE, [], ())
    artifacts = stub_build([trend_doc(keyword, tallies[keyword], ()) for keyword in SCOPE], len(SCOPE))

    assert serve_group_kpis(artifacts, GroupKpisParams(days=45)) is None


class TestSummaryKeywordPages:
    KEYWORDS = [f'hotel {index:03}' for index in range(230)]

    def _artifacts(self) -> FakeSnapshotArtifacts:
        tallies = keyword_tallies(self.KEYWORDS, [answer_row(keyword, index) for index, keyword in enumerate(self.KEYWORDS)], ())
        return stub_build([trend_doc(keyword, tallies[keyword], ()) for keyword in self.KEYWORDS], len(self.KEYWORDS))

    def test_concatenated_pages_hold_every_keyword_once_in_scope_order(self) -> None:
        artifacts = self._artifacts()
        rows = offset_pages(lambda offset: serve_group_kpis(artifacts, GroupKpisParams(days=30, view='keywords', offset=offset)), 'keywords')

        assert [row['keyword'] for row in rows] == self.KEYWORDS

    def test_the_summary_holds_the_first_page_and_the_total(self) -> None:
        body = serve_group_kpis(self._artifacts(), GroupKpisParams(days=30))

        assert body is not None
        assert (len(body['keywords']), body['keywords_total']) == (SUMMARY_KEYWORDS_PAGE, 230)


def test_the_registry_collects_the_group_kpis_builder() -> None:
    assert artifact_builders()['group-kpis'] is GROUP_KPIS_BUILDER
