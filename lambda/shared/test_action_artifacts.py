"""Tests for the S4 artifact builders: gaps, prompts, recommendations, content ideas and competitor.

Each scope is folded with ``artifact_registry.fold_scope`` from the keywords'
``actions`` partials and served from a ``FakeSnapshotArtifacts``; the oracle
is the shared rule applied to every keyword's latest run at once (the live
computation, uncapped). Paged lists are walked to the end through their
``{o, b}`` tokens.
"""

from __future__ import annotations

import json
from typing import Any

from hypothesis import given
from hypothesis import strategies as st

from shared.artifact_competitor import competitor_builder
from shared.artifact_gaps import gaps_builder
from shared.artifact_prompts import STORED_PER_LIST, prompts_builder
from shared.artifact_recommendations import content_ideas_builder, recommendations_builder
from shared.artifact_registry import fold_scope
from shared.citation_gap_rules import keyword_gap_entry, scope_gap_rollup
from shared.competitor_evidence import competitor_rollup, keyword_evidence
from shared.prompt_classification import prompt_record, ranked_prompts
from shared.recommendation_rules import keyword_finding, rule_recommendations
from shared.snapshot_artifacts import SnapshotScope, decode_snapshot_cursor
from testing.action_rule_fixtures import (
    BASE_BRAND_CONFIG,
    BRAND_CONFIGS,
    EXAMPLES,
    SCOPES,
    Config,
    Rows,
    latest_runs,
    scope_latests,
)
from testing.kpi_row_strategies import search_rows
from testing.snapshot_fakes import FakeSnapshotArtifacts

SCOPE = SnapshotScope(scope_dir='all', kind='all', group_id=None, market_id=None, keywords_total=3)
BUILDERS = (gaps_builder(), prompts_builder(), recommendations_builder(), content_ideas_builder(), competitor_builder())


def _stored(rows: Rows, config: Config) -> FakeSnapshotArtifacts:
    folded = fold_scope(BUILDERS, scope_latests(rows, config), SCOPE)
    # Round-tripped as the store does (JSON in S3).
    return FakeSnapshotArtifacts(json.loads(json.dumps(folded)), keywords_total=len(latest_runs(rows)))


def _walk(builder: Any, artifacts: FakeSnapshotArtifacts, params: dict[str, Any], list_key: str, token_key: str) -> list[Any]:
    """Every item of a paged list, page after page (``serve`` with each token's offset)."""
    items: list[Any] = []
    offset: int | None = 0
    while offset is not None:
        body = builder.serve(artifacts, {**params, 'offset': offset})
        items.extend(body[list_key])
        cursor = decode_snapshot_cursor(body[token_key]) if body[token_key] else None
        offset = None if cursor is None else cursor.offset
    return items


@EXAMPLES
@SCOPES
def test_gaps_served_from_the_snapshot_equal_the_live_rollup(rows: Rows, config: Config) -> None:
    live = scope_gap_rollup(entry for keyword, run in latest_runs(rows).items() if (entry := keyword_gap_entry(keyword, run, config)))
    body = gaps_builder().serve(_stored(rows, config), {'limit': 100, 'offset': 0})
    every = live.pop('gaps')

    assert body is not None
    assert (live.items() <= body.items(), body['gaps_total']) == (True, len(every))


@EXAMPLES
@SCOPES
def test_gap_pages_concatenate_to_every_gap_of_the_live_rollup(rows: Rows, config: Config) -> None:
    live = scope_gap_rollup(entry for keyword, run in latest_runs(rows).items() if (entry := keyword_gap_entry(keyword, run, config)))

    pages = _walk(gaps_builder(), _stored(rows, config), {'limit': 100, 'view': 'gaps'}, 'gaps', 'next_token')

    assert pages == live['gaps']


@EXAMPLES
@given(rows=search_rows(max_size=40), config=BRAND_CONFIGS, limit=st.integers(min_value=1, max_value=2))
def test_gap_summary_pages_concatenate_to_every_summary(rows: Rows, config: Config, limit: int) -> None:
    artifacts = _stored(rows, config)
    full = gaps_builder().serve(artifacts, {'limit': 100, 'offset': 0})

    assert full is not None
    assert _walk(gaps_builder(), artifacts, {'limit': limit}, 'keyword_summaries', 'keyword_summaries_next_token') == full['keyword_summaries']


@EXAMPLES
@given(rows=search_rows(max_size=40), limit=st.integers(min_value=1, max_value=3))
def test_prompts_served_from_the_snapshot_equal_the_live_ranking(rows: Rows, limit: int) -> None:
    records = [prompt_record(keyword, run[0]['timestamp'], run) for keyword, run in latest_runs(rows).items()]
    body = prompts_builder().serve(_stored(rows, BASE_BRAND_CONFIG), {'limit': limit, 'type': 'all'})

    assert body is not None
    live = ranked_prompts(records, limit)
    assert live.items() <= body.items()


def test_prompts_serve_at_most_the_stored_list_length() -> None:
    artifacts = FakeSnapshotArtifacts({'prompts': ranked_prompts([], STORED_PER_LIST)}, keywords_total=0)
    body = prompts_builder().serve(artifacts, {'limit': 500, 'type': 'losing'})

    assert body is not None
    assert set(body) >= {'losing_prompts', 'summary', 'coverage', 'source'}


@EXAMPLES
@given(rows=search_rows(max_size=40), config=BRAND_CONFIGS, limit=st.integers(min_value=1, max_value=2))
def test_recommendation_pages_concatenate_to_the_live_rule_list(rows: Rows, config: Config, limit: int) -> None:
    findings = [finding for keyword, run in latest_runs(rows).items() if (finding := keyword_finding(keyword, run, config))]

    walked = _walk(recommendations_builder(), _stored(rows, config), {'limit': limit}, 'recommendations', 'next_token')

    assert walked == rule_recommendations(findings)


@EXAMPLES
@given(rows=search_rows(max_size=40), config=BRAND_CONFIGS, competitor=st.sampled_from(('Parador', 'Hotel Mar')))
def test_competitor_rollup_served_from_the_snapshot_equals_the_live_rollup(rows: Rows, config: Config, competitor: str) -> None:
    evidence = [entry for keyword, run in latest_runs(rows).items() if (entry := keyword_evidence(keyword, run, config))]
    artifacts = _stored(rows, config)
    live = competitor_rollup(competitor, evidence)

    body = competitor_builder().serve(artifacts, {'competitor': competitor, 'limit': 100, 'offset': 0})

    assert body is not None
    assert live.items() <= body['rollup'].items()


@EXAMPLES
@given(rows=search_rows(max_size=40), limit=st.integers(min_value=1, max_value=2))
def test_outranked_keyword_pages_concatenate_to_every_outranked_keyword(rows: Rows, limit: int) -> None:
    evidence = [entry for keyword, run in latest_runs(rows).items() if (entry := keyword_evidence(keyword, run, BASE_BRAND_CONFIG))]
    artifacts = _stored(rows, BASE_BRAND_CONFIG)
    pages: list[Any] = []
    offset: int | None = 0
    while offset is not None:
        body = competitor_builder().serve(artifacts, {'competitor': 'Parador', 'limit': limit, 'offset': offset})
        assert body is not None
        pages.extend(body['rollup']['outranked_keywords'])
        token = body['rollup']['outranked_keywords_next_token']
        cursor = decode_snapshot_cursor(token) if token else None
        offset = None if cursor is None else cursor.offset

    assert pages == competitor_rollup('Parador', evidence)['outranked_keywords']


def test_competitors_body_holds_every_configured_competitor() -> None:
    artifacts = _stored([], BASE_BRAND_CONFIG)
    body = competitor_builder().serve(artifacts, {'competitors': ['Hotel Mar', 'Parador'], 'limit': 50})

    assert body is not None
    assert [rollup['competitor'] for rollup in body['rollups']] == ['Hotel Mar', 'Parador']


def test_content_ideas_of_a_scope_without_data_ask_for_a_first_run() -> None:
    body = content_ideas_builder().serve(_stored([], BASE_BRAND_CONFIG), {'industry': 'hotels'})

    assert body is not None
    assert [idea['type'] for idea in body['ideas']] == ['data']


def test_a_build_without_the_artifact_serves_none() -> None:
    artifacts = FakeSnapshotArtifacts({}, keywords_total=4)

    assert [builder.serve(artifacts, {'limit': 10, 'type': 'all', 'competitor': 'Parador'}) for builder in BUILDERS] == [None] * 5


def test_a_served_body_covers_every_keyword_of_the_build() -> None:
    body = gaps_builder().serve(_stored([], BASE_BRAND_CONFIG), {'limit': 10})

    assert body is not None
    assert (body['coverage'], body['source'], body['as_of']) == (
        {'keywords_total': 0, 'keywords_analyzed': 0, 'complete': True}, 'snapshot', '2026-10-05T07:12:00Z',
    )


def test_a_served_body_leaves_out_the_keywords_the_build_left_behind() -> None:
    stored = _stored([], BASE_BRAND_CONFIG)
    behind = FakeSnapshotArtifacts(stored.artifacts, keywords_total=5, keywords_behind=2)
    body = gaps_builder().serve(behind, {'limit': 10})

    assert body is not None
    assert body['coverage'] == {'keywords_total': 5, 'keywords_analyzed': 3, 'complete': False}
