"""Tests for the distributed citation rollup (``shared.citation_rollup_dist``): it publishes what the in-process build publishes."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from shared import citation_rollup_dist
from shared.citation_rollup import CURRENT_KEY, decode_json
from shared.citation_rollup_build import RollupBuildIncomplete
from shared.citation_rollup_dist import (
    REST,
    encode_entries,
    plan_merges,
    plan_rollup,
    plan_shards,
    publish_rollup,
    read_rollup_plan,
    rollup_needs_distribution,
    run_rollup_merge,
    run_rollup_shard,
    write_rollup_plan,
)
from shared.request_deadline import clear_request_deadline
from shared.scope_snapshot import snapshot_store
from testing.citation_rollup_fixtures import (
    DIST_BUILD_DIR,
    ROLLUP_BUCKET,
    ROLLUP_TEST_ROWS,
    FakeS3,
    SegmentedTable,
    distributed_rollup,
    published_rollup,
    published_view,
    rollup_keywords,
)
from testing.dynamodb_stubs import fake_table

#: 20 active keywords over two markets and three groups (``north`` stays inside one shard); keywords 020-029 are not active (rest).
_ACTIVE = rollup_keywords(
    20,
    groups={index: {'coast'} for index in range(10)} | {index: {'coast', 'spa'} for index in range(10, 15)} | {0: {'coast', 'north'}, 2: {'north'}},
    markets=dict.fromkeys(range(0, 20, 2), 'es-es'),
)
_BRANDS = {'tracked_brands': {'first_party': ['site-3'], 'competitors': ['site-5']}, 'updated_at': '2026-11-01T00:00:00Z'}
_NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _no_leftover_deadline() -> Iterator[None]:
    yield
    clear_request_deadline()


@pytest.fixture(scope='module')
def oracle() -> dict:
    """The in-process build's published rollup, as a reader sees it."""
    return published_view(FakeS3(objects=published_rollup(ROLLUP_TEST_ROWS, _ACTIVE, _BRANDS)))


@pytest.fixture
def small_shards() -> Iterator[None]:
    """Shards of ~6 keywords (150 rows a keyword) and merge items of ~2 keywords: every market split, several merge items."""
    with patch.object(citation_rollup_dist, 'ROLLUP_SHARD_ROWS', 900), patch.object(citation_rollup_dist, 'ROLLUP_MERGE_ROWS', 300):
        yield


def _view(**kwargs) -> dict:
    s3 = FakeS3()
    distributed_rollup(ROLLUP_TEST_ROWS, _ACTIVE, s3, _BRANDS, **kwargs)
    return published_view(s3)


class TestEquality:
    def test_one_shard_publishes_the_scopes_of_the_in_process_build(self, oracle):
        assert sorted(_view()) == sorted(oracle)

    def test_one_shard_publishes_every_scope_file_of_the_in_process_build(self, oracle):
        assert _view() == oracle

    @pytest.mark.usefixtures('small_shards')
    def test_split_markets_and_merged_groups_publish_every_scope_file_of_the_in_process_build(self, oracle):
        assert _view() == oracle

    @pytest.mark.usefixtures('small_shards')
    def test_a_group_inside_one_shard_is_written_by_the_shard_not_merged(self):
        plan = plan_rollup(SegmentedTable(ROLLUP_TEST_ROWS, 200, item_count=3_000), fake_table(query={'Items': _ACTIVE}), FakeS3(), ROLLUP_BUCKET, _BRANDS, lambda: _NOW)
        assert ('group:north' in plan.scope_shards, any('group:north' in item for item in plan.merges)) == (True, False)


class TestPlan:
    def test_whole_markets_share_a_shard_while_they_fit(self):
        markets = {'market:a': ['a1', 'a2'], 'market:b': ['b1'], 'market:c': ['c1', 'c2']}
        with patch.object(citation_rollup_dist, 'ROLLUP_SHARD_ROWS', 300):
            assert plan_shards(markets, 100.0) == [['a1', 'a2', 'b1'], ['c1', 'c2']]

    def test_a_market_larger_than_a_shard_is_split(self):
        with patch.object(citation_rollup_dist, 'ROLLUP_SHARD_ROWS', 200):
            assert plan_shards({'market:a': ['a3', 'a1', 'a2'], 'market:b': ['b1']}, 100.0) == [['a1', 'a2'], ['a3'], ['b1']]

    def test_merges_hold_scopes_of_several_shards_and_table_within_the_row_budget(self):
        shards = {'all': [0, 1], 'group:g': [0, 1], 'group:h': [0, 1], 'market:m': [0], 'table': [0, 1]}
        sizes = {'all': 4, 'group:g': 1, 'group:h': 1, 'market:m': 2, 'table': 4}
        with patch.object(citation_rollup_dist, 'ROLLUP_MERGE_ROWS', 250):
            assert plan_merges(shards, sizes, 100.0) == [['all'], ['group:g', 'group:h'], ['table']]

    def test_a_table_above_the_in_process_rows_is_distributed(self):
        rows = citation_rollup_dist.ROLLUP_IN_PROCESS_ROWS
        assert [rollup_needs_distribution(SegmentedTable([], 1, item_count=count)) for count in (rows, rows + 1)] == [False, True]

    def test_no_citations_table_is_never_distributed(self):
        assert rollup_needs_distribution(None) is False


class TestSteps:
    def test_a_shard_whose_fragment_exists_writes_nothing_again(self):
        s3 = FakeS3()
        distributed_rollup(ROLLUP_TEST_ROWS, _ACTIVE, s3, _BRANDS)
        before = dict(s3.objects)
        result = run_rollup_shard(snapshot_store(s3, ROLLUP_BUCKET), DIST_BUILD_DIR, SegmentedTable([], 1), s3, ROLLUP_BUCKET, 0)
        assert (result['status'], s3.objects == before) == ('done before', True)

    @pytest.mark.usefixtures('small_shards')
    def test_publish_refuses_while_a_merge_is_not_written(self):
        s3 = FakeS3()
        store = snapshot_store(s3, ROLLUP_BUCKET)
        table = SegmentedTable(ROLLUP_TEST_ROWS, 200, item_count=3_000)
        plan = plan_rollup(table, fake_table(query={'Items': _ACTIVE}), s3, ROLLUP_BUCKET, _BRANDS, lambda: _NOW)
        write_rollup_plan(store, DIST_BUILD_DIR, plan)
        for shard in range(len(plan.shards) + 1):
            run_rollup_shard(store, DIST_BUILD_DIR, table, s3, ROLLUP_BUCKET, shard)
        run_rollup_merge(store, DIST_BUILD_DIR, s3, ROLLUP_BUCKET, 0)
        with pytest.raises(RollupBuildIncomplete, match='merges item 1'):
            publish_rollup(store, DIST_BUILD_DIR, s3, ROLLUP_BUCKET, lambda: _NOW)
        assert CURRENT_KEY not in s3.objects

    @pytest.mark.usefixtures('small_shards')
    def test_publish_deletes_the_partials(self):
        s3 = FakeS3()
        summary = distributed_rollup(ROLLUP_TEST_ROWS, _ACTIVE, s3, _BRANDS)
        assert summary is not None
        assert [key for key in s3.objects if '/_partials/' in key] == []

    def test_the_rest_item_counts_only_rows_of_keywords_not_active(self):
        s3 = FakeS3()
        distributed_rollup(ROLLUP_TEST_ROWS, _ACTIVE, s3, _BRANDS)
        plan = read_rollup_plan(snapshot_store(s3, ROLLUP_BUCKET), DIST_BUILD_DIR)
        assert plan is not None
        rest = json.loads(s3.objects[f'{DIST_BUILD_DIR}rollup/shards/{len(plan.shards)}.json'])
        assert rest == {'scopes': {}, 'rows': 1_000}

    def test_no_plan_publishes_no_rollup(self):
        s3 = FakeS3()
        write_rollup_plan(snapshot_store(s3, ROLLUP_BUCKET), DIST_BUILD_DIR, None)
        assert publish_rollup(snapshot_store(s3, ROLLUP_BUCKET), DIST_BUILD_DIR, s3, ROLLUP_BUCKET) is None


def test_entries_encoded_in_slices_decode_to_the_whole_document():
    rows = [[f'https://e.example/{index}', index, 1, 'page', 'e.example', {'openai': 1}, [0]] for index in range(12)]
    with patch.object(citation_rollup_dist, 'ENTRIES_SLICE', 5):
        assert decode_json(encode_entries(['kw ñ'], rows)) == {'keywords': ['kw ñ'], 'entries': rows}


def test_table_merges_the_inputs_of_all_and_the_rest_partial():
    plan = plan_rollup(SegmentedTable([], 1), fake_table(query={'Items': _ACTIVE}), FakeS3(), ROLLUP_BUCKET, _BRANDS, lambda: _NOW)
    assert plan.inputs('table') == [*plan.inputs('all'), plan.partial_path(REST, 'table')]
