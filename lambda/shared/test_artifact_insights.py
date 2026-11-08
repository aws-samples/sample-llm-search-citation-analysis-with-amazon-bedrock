"""Tests for shared.artifact_insights: the ``/reports/insights`` facts of a scope snapshot.

The oracle is the live computation of ``GET /api/reports/insights``
(``insights_engine.compute_insights`` over every keyword's latest-run answers,
and ``stability_facts`` over ``group_kpi_history.keyword_history``).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, cast
from unittest.mock import patch

from hypothesis import given
from hypothesis import strategies as st

from shared import partial_insights
from shared.artifact_insights import InsightsBuilder, coverage_fields, history_entries
from shared.artifact_registry import fold_scope
from shared.group_kpi_history import keyword_history
from shared.insights_citations import competitor_domains_from
from shared.insights_engine import compute_insights, stability_facts
from shared.insights_pages import with_page_tokens
from shared.kpi_engine import KPI_IDS, answers_from_rows, owned_domains_from
from shared.partial_contract import KeywordLatest, KeywordLatestRun, PartialConfig
from shared.snapshot_artifacts import SnapshotScope
from shared.visibility_views import visibility_view
from testing.action_rule_fixtures import EXAMPLES, SCOPES, Config, Rows, latest_runs
from testing.snapshot_fakes import FakeSnapshotArtifacts

ALL = SnapshotScope(scope_dir='all', kind='all', group_id=None, market_id=None, keywords_total=3)
GROUP = SnapshotScope(scope_dir='group-g1', kind='group', group_id='g1', market_id=None, keywords_total=3)
NOW = datetime(2026, 10, 10, tzinfo=UTC)
SERIES_KPIS = ['answers', 'mentions', 'mention_rate', 'average_position']


def _latest(keyword: str, rows: Rows, config: Config, series: list[list[Any]] | None = None) -> KeywordLatest:
    part = partial_insights.build(rows, PartialConfig(brand_config=config, personas=()))
    run: KeywordLatestRun | None = None if part is None else {'timestamp': part['timestamp'], 'parts': {'insights': part}}
    latest: KeywordLatest = {'v': 1, 'keyword': keyword, 'keyword_id': '', 'config': '', 'latest': run, 'previous': None}
    if series is not None:
        # S1's KeywordLatest object carries the series beside the partial contract's fields.
        cast(dict[str, Any], latest)['series'] = {'k': SERIES_KPIS, 'r': series}
    return latest


def _stored(latests: list[KeywordLatest], scope: SnapshotScope) -> FakeSnapshotArtifacts:
    with patch('shared.artifact_insights.utc_now', return_value=NOW):
        folded = fold_scope([InsightsBuilder()], latests, scope)
    return FakeSnapshotArtifacts(json.loads(json.dumps(folded)), keywords_total=len(latests))


@EXAMPLES
@SCOPES
def test_snapshot_insights_equal_the_live_insights(rows: Rows, config: Config) -> None:
    runs = latest_runs(rows)
    answers = [answer for run in runs.values() for answer in answers_from_rows(run)]
    live = compute_insights(answers, owned_domains_from(config), None, competitor_domains_from(config))

    params = {'days': 90, 'owned_domains': owned_domains_from(config), 'competitor_domains': competitor_domains_from(config)}
    artifacts = _stored([_latest(keyword, run, config) for keyword, run in runs.items()], ALL)
    body = InsightsBuilder().serve(artifacts, params)

    assert body is not None
    assert (body['facts'], body['insights']) == (with_page_tokens(live, artifacts.build_id)['facts'], live['insights'])


@EXAMPLES
@SCOPES
def test_coverage_fields_equal_the_visibility_view(rows: Rows, config: Config) -> None:
    runs = latest_runs(rows)
    by_keyword = {keyword: answers_from_rows(run) for keyword, run in runs.items()}
    view = visibility_view(list(runs), by_keyword)
    merged = None
    for run in runs.values():
        part = partial_insights.build(run, PartialConfig(brand_config=config, personas=()))
        merged = merged if part is None else partial_insights.merge(merged, part)

    assert coverage_fields(len(runs), merged) == {key: view[key] for key in ('timestamp', 'keywords_analyzed', 'keywords_with_data')}


_RUN_KPIS = st.fixed_dictionaries({
    'mentions': st.integers(min_value=0, max_value=3),
    'average_position': st.one_of(st.none(), st.floats(min_value=1, max_value=9, allow_nan=False).map(lambda value: round(value, 2))),
})


@EXAMPLES
@given(runs=st.dictionaries(st.sampled_from([f'2026-{month:02d}-0{day}T06:00:00Z' for month in (6, 8, 9, 10) for day in (1, 5)]), _RUN_KPIS, max_size=8))
def test_stability_from_the_series_equals_the_group_history_stability(runs: dict[str, dict[str, Any]]) -> None:
    since = '2026-08-01'
    series = {'spa': [[timestamp, kpis['mentions'], kpis['average_position']] for timestamp, kpis in runs.items()]}
    windowed = {timestamp: {**dict.fromkeys(KPI_IDS, 0), **kpis} for timestamp, kpis in runs.items() if timestamp >= since}

    assert stability_facts(history_entries(series, since)) == stability_facts([keyword_history('spa', windowed)])


def test_a_group_serves_the_stability_of_a_stored_preset() -> None:
    series = [['2026-10-01T06:00:00Z', 4, 1, 25.0, 2.0], ['2026-10-05T06:00:00Z', 4, 0, 0.0, 7.0]]
    body = InsightsBuilder().serve(_stored([_latest('spa', [], {}, series=series)], GROUP), {'days': 30})

    assert body is not None
    assert body['facts']['stability'][0]['position_range'] == 5.0


def test_a_group_asked_for_a_window_that_is_not_a_preset_serves_none() -> None:
    assert InsightsBuilder().serve(_stored([_latest('spa', [], {})], GROUP), {'days': 45}) is None


def test_a_scope_that_is_not_a_group_has_no_stability() -> None:
    body = InsightsBuilder().serve(_stored([_latest('spa', [], {})], ALL), {'days': 45})

    assert body is not None
    assert body['facts']['stability'] == []


def test_a_build_without_the_caveat_reasons_fact_leaves_its_pages_to_a_view_job() -> None:
    stored = _stored([_latest('spa', [], {})], ALL)
    artifact = stored.artifacts['insights']
    artifact['facts'].pop('caveat_reasons')

    assert InsightsBuilder().serve(stored, {'days': 90, 'view': 'caveat_reasons'}) is None
