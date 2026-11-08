"""Tests for shared.partial_kpi and shared.artifact_latest: the visibility view folded from per-keyword pools equals the live view of every answer."""

from __future__ import annotations

import random

from hypothesis import assume, given, reject, settings
from hypothesis import strategies as st

from shared import partial_kpi
from shared.artifact_latest import KEYWORDS_PAGE, LATEST_BUILDER
from shared.artifact_registry import artifact_builders
from shared.partial_contract import PartialConfig
from shared.snapshot_artifacts import SnapshotCursor, decode_snapshot_cursor
from testing.kpi_latest_fixtures import (
    kpi_parts,
    oracle_visibility,
    scope_latests,
    served_visibility,
    snapshot_artifacts,
    view_fields,
)
from testing.kpi_row_strategies import KEYWORDS, OWNED_DOMAINS, search_rows
from testing.kpi_trends_fixtures import offset_pages
from testing.search_result_fixtures import successful_answer_row

SCOPE = sorted(KEYWORDS, key=str.casefold)
PERSONAS = st.sampled_from((None, 'default', 'family', 'business', 'nobody'))
BRAND_FILTERS = st.sampled_from((None, 'hotel', 'MEL', 'zz'))
RUN = '2026-10-01T06:00:00.000000Z'
TRACKED = st.sampled_from(((), ('Parador',), ('NH', 'Hotel Mar')))


def _spa_row(timestamp: str) -> dict:
    """One openai answer to ``spa`` naming the first party first and citing its site."""
    return successful_answer_row(keyword='spa', timestamp=timestamp, provider='openai', brands=[('Hotel Sol', 'first_party', 1)], citations=['https://hotel-sol.com/'])


@settings(max_examples=150, deadline=None)
@given(rows=search_rows(max_size=60), owned=OWNED_DOMAINS, persona=PERSONAS, brand=BRAND_FILTERS, tracked=TRACKED)
def test_snapshot_view_equals_the_live_view_of_every_answer(rows, owned, persona, brand, tracked) -> None:
    artifacts = snapshot_artifacts(scope_latests(SCOPE, rows, owned), keywords_total=len(SCOPE))

    served = served_visibility(
        artifacts, persona=persona, brand=brand, tracked_brands=tracked, citations_configured=bool(owned), page_size=None,
    )
    if served is None:
        # A persona no answer of the scope asked is not stored (a view job computes it).
        reject()

    assert view_fields(served) == oracle_visibility(SCOPE, rows, owned, persona=persona, brand=brand, tracked_brands=tracked)


@settings(max_examples=60, deadline=None)
@given(rows=search_rows(max_size=60), owned=OWNED_DOMAINS, seed=st.integers(min_value=0, max_value=2**16))
def test_fold_order_does_not_change_the_artifacts(rows, owned, seed) -> None:
    latests = scope_latests(SCOPE, rows, owned)
    shuffled = list(latests)
    random.Random(seed).shuffle(shuffled)

    assert snapshot_artifacts(shuffled, len(SCOPE)).artifacts == snapshot_artifacts(latests, len(SCOPE)).artifacts


@settings(max_examples=60, deadline=None)
@given(rows=search_rows(min_size=20, max_size=60), owned=OWNED_DOMAINS)
def test_merge_is_associative_over_three_keywords(rows, owned) -> None:
    parts = kpi_parts(scope_latests(SCOPE, rows, owned))
    assume(len(parts) == 3)
    first, second, third = parts

    left = partial_kpi.merge(partial_kpi.merge(partial_kpi.merge(None, first), second), third)
    right = partial_kpi.merge(partial_kpi.merge(None, first), partial_kpi.merge(partial_kpi.merge(None, second), third))

    assert left == right


def test_build_returns_none_when_no_row_is_an_answer() -> None:
    failed = {**successful_answer_row(keyword='spa', timestamp=RUN, provider='openai', brands=(), citations=[]), 'status': 'error'}

    assert partial_kpi.build([failed], PartialConfig()) is None


def test_a_run_stored_before_the_branded_flag_has_no_filtered_slices() -> None:
    classified = {**_spa_row(RUN), 'branded': False}
    unflagged = _spa_row(RUN)
    assert 'branded' not in unflagged

    flagged_part = partial_kpi.build([classified], PartialConfig())
    old_part = partial_kpi.build([classified, unflagged], PartialConfig())

    assert flagged_part is not None
    assert old_part is not None
    assert (sorted(flagged_part['slices']), sorted(old_part['slices'])) == (
        ['_all', '_all@neutral', 'default', 'default@neutral'], ['_all', 'default'],
    )


def test_merge_leaves_the_added_part_unchanged() -> None:
    row = _spa_row(RUN)
    part = partial_kpi.build([row], PartialConfig())
    assert part is not None
    before = repr(part)

    partial_kpi.merge(partial_kpi.merge(None, part), part)

    assert repr(part) == before


def test_builder_is_registered_under_latest() -> None:
    assert artifact_builders()['latest'] is LATEST_BUILDER


def test_accumulator_keeps_only_the_row_fields_of_each_keyword_slice() -> None:
    row = _spa_row(RUN)
    acc = LATEST_BUILDER.add(None, scope_latests(['spa'], [row], ())[0])

    assert {field for _order, _keyword, slices in acc.keywords for pool in slices.values() for field in pool} == {'timestamp', 'engines', 'keywords'}


def test_serve_returns_none_for_a_persona_the_build_does_not_hold() -> None:
    artifacts = snapshot_artifacts(scope_latests(SCOPE, [], ()), keywords_total=len(SCOPE))

    assert served_visibility(artifacts, persona='family') is None


def test_summary_holds_the_first_keyword_page_and_a_token_to_the_next() -> None:
    keywords = [f'kw {index:03}' for index in range(KEYWORDS_PAGE + 5)]
    artifacts = snapshot_artifacts(scope_latests(keywords, [], ()), keywords_total=len(keywords), build_id='build-7')

    served = served_visibility(artifacts)

    assert served is not None
    assert (len(served['keywords']), served['keywords_total']) == (KEYWORDS_PAGE, KEYWORDS_PAGE + 5)
    assert decode_snapshot_cursor(served['keywords_next_token']) == SnapshotCursor(offset=KEYWORDS_PAGE, build_id='build-7')


def test_keyword_pages_concatenate_to_every_row_once_in_scope_order() -> None:
    keywords = sorted((f'Kw {index:03}' for index in range(2 * KEYWORDS_PAGE + 7)), key=str.casefold)
    artifacts = snapshot_artifacts(scope_latests(keywords, [], ()), keywords_total=len(keywords))
    rows = offset_pages(lambda offset: served_visibility(artifacts, view='keywords', offset=offset), 'keywords')

    assert [row['keyword'] for row in rows] == keywords


def test_compared_pools_keep_only_the_counts_the_change_reads() -> None:
    rows = [_spa_row(stamp) for stamp in ('2026-09-01T06:00:00.000000Z', RUN)]
    pools = LATEST_BUILDER.add(None, scope_latests(['spa'], rows, ())[0]).variants[partial_kpi.ALL]

    assert (sorted(pools.compared_latest or {}), sorted(pools.compared_previous or {})) == (['engines', 'keywords', 'timestamp'],) * 2
