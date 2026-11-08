"""Tests for shared.partial_actions: one keyword's action findings, and their order-free merge."""

from __future__ import annotations

import json
from typing import Any

from hypothesis import given
from hypothesis import strategies as st

from shared import partial_actions
from shared.partial_contract import PartialConfig
from testing import action_rule_fixtures as fx
from testing.kpi_row_strategies import search_rows

CONFIG = PartialConfig(brand_config=fx.BASE_BRAND_CONFIG, personas=())


def _parts(rows: fx.Rows, brand_config: fx.Config) -> list[dict[str, Any]]:
    config = PartialConfig(brand_config=brand_config, personas=())
    return [part for run in fx.latest_runs(rows).values() if (part := partial_actions.build(run, config))]


def test_build_is_none_for_a_run_without_rows() -> None:
    assert partial_actions.build([], CONFIG) is None


def test_build_keeps_the_keyword_and_its_run_timestamp() -> None:
    rows = [{'keyword': 'spa', 'timestamp': '2026-10-01T06:00:00Z', 'provider': 'openai', 'brands': [], 'citations': []}]
    part = partial_actions.build(rows, CONFIG)

    assert part is not None
    assert (part['keyword'], part['timestamp']) == ('spa', '2026-10-01T06:00:00Z')


@fx.EXAMPLES
@given(rows=search_rows(min_size=1, max_size=30), config=fx.BRAND_CONFIGS)
def test_build_is_stored_unchanged_as_json(rows: fx.Rows, config: fx.Config) -> None:
    for part in _parts(rows, config):
        assert json.loads(json.dumps(part)) == part


@fx.EXAMPLES
@given(rows=search_rows(max_size=30), seed=st.randoms())
def test_merge_ignores_the_order_parts_arrive_in(rows: fx.Rows, seed: Any) -> None:
    parts = _parts(rows, fx.BASE_BRAND_CONFIG)
    shuffled = fx.reordered(parts, seed)
    forward = backward = None
    for part in parts:
        forward = partial_actions.merge(forward, part)
    for part in shuffled:
        backward = partial_actions.merge(backward, part)

    assert forward == backward


def test_merge_keeps_the_newer_run_of_one_keyword() -> None:
    older = {'keyword': 'spa', 'timestamp': '2026-10-01', 'gaps': None}
    newer = {'keyword': 'spa', 'timestamp': '2026-10-02', 'gaps': None}

    assert partial_actions.merge(partial_actions.merge(None, newer), older) == {'keywords': {'spa': newer}}


def test_merge_never_changes_the_part() -> None:
    part = {'keyword': 'spa', 'timestamp': '2026-10-01', 'gaps': None}
    partial_actions.merge(None, part)

    assert part == {'keyword': 'spa', 'timestamp': '2026-10-01', 'gaps': None}
