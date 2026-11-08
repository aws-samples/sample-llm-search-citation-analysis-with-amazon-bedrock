"""The ``mentions`` partial: build per keyword-run, merge associative and order-free (design 2.45.0 §5 test 1).

That merged partials serve the live summary is ``test_mention_snapshot_properties.py``.
"""

from __future__ import annotations

import copy
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from shared.partial_contract import PartialConfig
from shared.partial_mentions import ALL_COMBO, build, combo_key, merge, order_key, sentiment_key
from testing.scale_data import ScaleSpec, keyword_text, search_result_rows

_SPEC = ScaleSpec(keywords=8, personas=2, runs=1, long_tail=9)


def _parts() -> list[dict[str, Any]]:
    parts = [build(search_result_rows(_SPEC, index, 0), PartialConfig()) for index in range(_SPEC.keywords)]
    return [part for part in parts if part is not None]


@pytest.fixture
def third_keyword() -> dict[str, Any]:
    """The partial of keyword 3's only run."""
    part = build(search_result_rows(_SPEC, 3, 0), PartialConfig())
    assert part is not None
    return part


def test_build_returns_none_for_a_run_without_rows():
    assert build([], PartialConfig()) is None


def test_build_counts_every_row_in_the_unfiltered_combo(third_keyword):
    timestamp = search_result_rows(_SPEC, 3, 0)[0]['timestamp']

    assert third_keyword['combos'][ALL_COMBO] == {'rows': 2 * 4, 'keywords': 1, 'ts': timestamp}


def test_build_keys_one_combo_per_persona_and_provider(third_keyword):
    assert combo_key('persona-01', 'gemini') in third_keyword['combos']


def test_build_orders_appearances_by_the_keyword_text(third_keyword):
    first = next(iter(third_keyword['brands'][ALL_COMBO].values()))

    assert first['f'][1] == keyword_text(3)


def test_sentiment_key_joins_classification_sentiment_and_provider():
    assert sentiment_key('first_party', 'positive', 'openai') == 'first_party|positive|openai'


def test_order_key_sorts_keywords_case_insensitively_first():
    assert order_key('Hotel B', 'x', 0) > order_key('hotel a', 'z', 9)


@settings(max_examples=25, deadline=None)
@given(order=st.permutations(range(_SPEC.keywords)), split=st.integers(min_value=0, max_value=_SPEC.keywords))
def test_merge_is_order_free_and_associative(order, split):
    parts = _parts()
    shuffled = [parts[index] for index in order if index < len(parts)]
    in_order = None
    for part in parts:
        in_order = merge(in_order, part)
    left = None
    for part in shuffled[:split]:
        left = merge(left, part)
    right = None
    for part in shuffled[split:]:
        right = merge(right, part)
    grouped = right if left is None else (left if right is None else merge(left, right))

    assert grouped == in_order


def test_merge_never_mutates_the_part():
    parts = _parts()
    before = copy.deepcopy(parts[1])
    merge(merge(None, parts[0]), parts[1])

    assert parts[1] == before
